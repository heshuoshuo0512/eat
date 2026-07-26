import http from 'k6/http';
import { check, sleep } from 'k6';

const scenario = __ENV.SCENARIO || 'catalog';
const baseUrl = (__ENV.BASE_URL || 'http://host.docker.internal:18080/api').replace(/\/$/, '');
const vus = Math.max(1, Number(__ENV.VUS || 100));
const duration = __ENV.DURATION || '5m';
const accessToken = __ENV.ACCESS_TOKEN || '';
const thinkTimeSeconds = Math.max(0.1, Number(__ENV.THINK_TIME_SECONDS || 1));

function benchmarkClientIp() {
  const index = Math.max(0, __VU - 1);
  const scenarioOffset = { catalog: 0, session: 64, community: 128, agent: 192 }[scenario] || 224;
  const thirdOctet = (scenarioOffset + Math.floor(index / 254)) % 256;
  const fourthOctet = (index % 254) + 1;
  return `198.18.${thirdOctet}.${fourthOctet}`;
}

const durationLimit = scenario === 'agent' ? 30_000 : 2_000;
export const options = {
  scenarios: {
    selected: {
      executor: 'constant-vus',
      vus,
      duration,
      gracefulStop: '30s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${durationLimit}`]
  }
};

function headers(authenticated = false) {
  return {
    'Content-Type': 'application/json',
    'X-Forwarded-For': benchmarkClientIp(),
    ...(authenticated && accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
}

function expect(response, expectedStatus, name) {
  check(response, { [`${name} returns ${expectedStatus}`]: (value) => value.status === expectedStatus });
}

function catalogScenario() {
  const paths = ['/canteens', '/menus/today?mealType=lunch', '/rankings'];
  const path = paths[(__ITER + __VU) % paths.length];
  const response = http.get(`${baseUrl}${path}`, {
    headers: headers(Boolean(accessToken)), tags: { operation: path.split('?')[0] }
  });
  expect(response, 200, path);
}

function sessionScenario() {
  const identifier = __ENV.IDENTIFIER || '';
  const password = __ENV.PASSWORD || '';
  if (!identifier || !password) throw new Error('IDENTIFIER and PASSWORD are required for the session scenario');
  const login = http.post(`${baseUrl}/auth/login`, JSON.stringify({ identifier, password }), {
    headers: headers(), tags: { operation: 'auth.login' }
  });
  expect(login, 200, 'login');
  if (login.status !== 200) return;
  const refreshToken = login.json('refreshToken');
  const refresh = http.post(`${baseUrl}/auth/refresh`, JSON.stringify({ refreshToken }), {
    headers: headers(), tags: { operation: 'auth.refresh' }
  });
  expect(refresh, 200, 'refresh');
}

function communityScenario() {
  const targetType = __ENV.TARGET_TYPE || 'canteen';
  const targetId = __ENV.TARGET_ID || '';
  if (!accessToken || !targetId) throw new Error('ACCESS_TOKEN and TARGET_ID are required for the community scenario');
  const content = `k6 release candidate ${__VU}-${__ITER}-${Date.now()}`;
  const response = http.post(`${baseUrl}/posts`, JSON.stringify({ targetType, targetId, content }), {
    headers: headers(true), tags: { operation: 'posts.create' }
  });
  expect(response, 201, 'post creation');
}

function agentScenario() {
  const query = __ENV.AGENT_QUERY || '午饭预算15元，想吃清淡高蛋白的菜';
  const response = http.post(`${baseUrl}/agent/meal-advisor`, JSON.stringify({ query }), {
    headers: headers(Boolean(accessToken)), tags: { operation: 'agent.meal-advisor' }
  });
  expect(response, 200, 'meal advisor');
}

export default function () {
  if (scenario === 'session') sessionScenario();
  else if (scenario === 'community') communityScenario();
  else if (scenario === 'agent') agentScenario();
  else catalogScenario();
  sleep(scenario === 'catalog' ? thinkTimeSeconds : 0.5);
}
