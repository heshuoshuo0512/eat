import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createCollectorServer } from '../collector-server/app.js';
import { bootstrapCollectorStaff } from '../collector-server/auth.js';
import { syncCollectorCatalog } from '../collector-server/catalog.js';
import { openCollectorDatabase } from '../collector-server/database.js';

const catalog = {
  manifest: { dataVersion: 'collector-test-v1' },
  canteens: [
    { id: 'west-floor2-east', name: '西区二楼东厅' },
    { id: 'east-dongdahuo', name: '东大活' },
  ],
  stalls: [
    { id: 'stall-west-1', canteenId: 'west-floor2-east', name: '家常菜档口' },
    { id: 'stall-east-1', canteenId: 'east-dongdahuo', name: '风味档口' },
  ],
  dishes: [
    { id: 'dish-tomato-eggs-west', stallId: 'stall-west-1', name: '番茄炒蛋', aliases: ['西红柿炒鸡蛋'] },
    { id: 'dish-potato-west', stallId: 'stall-west-1', name: '土豆丝' },
    { id: 'dish-tomato-eggs-east', stallId: 'stall-east-1', name: '番茄炒蛋' },
  ],
};

async function call(base, path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, { method, body, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

function draftForm(image, name = '番茄炒蛋', groupId = 'collector-west-halls', requestAiSuggestion = true) {
  const form = new FormData();
  form.append('groupId', groupId);
  form.append('claimedName', name);
  form.append('requestAiSuggestion', String(requestAiSuggestion));
  form.append('image', new Blob([image], { type: 'image/jpeg' }), 'meal.jpg');
  return form;
}

test('collector API enforces anonymous ownership, image hygiene, review points, and withdrawal', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'smart-canteen-collector-'));
  process.env.COLLECTOR_DB = join(root, 'collector.sqlite');
  process.env.COLLECTOR_UPLOAD_DIR = join(root, 'uploads');
  process.env.AI_API_KEY = '';
  process.env.AI_CHAT_API_KEY = '';
  const db = await openCollectorDatabase();
  await syncCollectorCatalog(db, catalog);
  await bootstrapCollectorStaff(db, { username: 'reviewer', password: 'reviewer-password', role: 'collector_reviewer' });
  const server = createCollectorServer({ db });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  const groups = await call(base, '/api/collector/groups');
  assert.equal(groups.response.status, 200);
  assert.equal(groups.payload.groups.length, 4);
  let contributorCookie = groups.cookie;

  const inputImage = await sharp({ create: { width: 420, height: 320, channels: 3, background: '#c94a3f' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'collector-test' } } })
    .jpeg()
    .toBuffer();
  const draftResponse = await call(base, '/api/collector/drafts', { method: 'POST', cookie: contributorCookie, body: draftForm(inputImage, '番茄炒蛋', 'collector-west-halls', false) });
  assert.equal(draftResponse.response.status, 201);
  contributorCookie = draftResponse.cookie;
  const draft = draftResponse.payload.draft;
  assert.equal(draft.aiSuggestionStatus, 'skipped');
  assert.deepEqual(draft.aiNames, []);
  assert.ok(draft.candidates.some((item) => item.dishId === 'dish-tomato-eggs-west'));

  const duplicate = await call(base, '/api/collector/drafts', { method: 'POST', cookie: contributorCookie, body: draftForm(inputImage) });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.code, 'DUPLICATE_IMAGE');

  const stranger = await call(base, '/api/collector/groups');
  const forbiddenImage = await call(base, draft.imageUrl, { cookie: stranger.cookie });
  assert.equal(forbiddenImage.response.status, 403);
  const ownImage = await call(base, draft.imageUrl, { cookie: contributorCookie });
  assert.equal(ownImage.response.status, 200);
  const normalizedMetadata = await sharp(ownImage.payload).metadata();
  assert.equal(normalizedMetadata.width, 420);
  assert.equal(normalizedMetadata.exif, undefined);

  const outOfScope = await call(base, `/api/collector/drafts/${draft.id}/confirm`, {
    method: 'POST', cookie: contributorCookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dishId: 'dish-tomato-eggs-east', consent: true, consentVersion: 'collector-training-v1' }),
  });
  assert.equal(outOfScope.response.status, 400);
  assert.equal(outOfScope.payload.code, 'DISH_OUT_OF_GROUP_SCOPE');

  const confirmed = await call(base, `/api/collector/drafts/${draft.id}/confirm`, {
    method: 'POST', cookie: contributorCookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dishId: 'dish-tomato-eggs-west', consent: true, consentVersion: 'collector-training-v1' }),
  });
  assert.equal(confirmed.response.status, 200);
  await db.run('UPDATE collector_submissions SET needs_second_review = 0 WHERE id = ?', [draft.id]);

  const staffLogin = await call(base, '/api/collector/staff/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'reviewer-password', username: 'reviewer' }),
  });
  assert.equal(staffLogin.response.status, 200);
  const queue = await call(base, '/api/collector/review/submissions?status=pending_review', { cookie: staffLogin.cookie });
  assert.equal(queue.payload.submissions[0].groupId, 'collector-west-halls');
  assert.equal(queue.payload.submissions[0].contributorId, undefined);

  const approved = await call(base, `/api/collector/review/submissions/${draft.id}/decision`, {
    method: 'POST', cookie: staffLogin.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', dishId: 'dish-tomato-eggs-west' }),
  });
  assert.equal(approved.payload.submission.status, 'approved');
  const me = await call(base, '/api/collector/me', { cookie: contributorCookie });
  assert.equal(me.payload.points, 15);

  const withdrawn = await call(base, `/api/collector/submissions/${draft.id}`, { method: 'DELETE', cookie: contributorCookie });
  assert.equal(withdrawn.payload.submission.status, 'withdrawn');
  const afterWithdrawal = await call(base, '/api/collector/me', { cookie: contributorCookie });
  assert.equal(afterWithdrawal.payload.points, 0);
  const stored = await db.get('SELECT storage_key FROM collector_objects WHERE id = ?', [draft.imageUrl.split('/').at(-1)]);
  await assert.rejects(readFile(join(root, 'uploads', stored.storage_key)));
});

test('collector API rejects forged image payloads', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'smart-canteen-collector-invalid-'));
  process.env.COLLECTOR_DB = join(root, 'collector.sqlite');
  process.env.COLLECTOR_UPLOAD_DIR = join(root, 'uploads');
  const db = await openCollectorDatabase();
  await syncCollectorCatalog(db, catalog);
  const server = createCollectorServer({ db });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); await db.close(); await rm(root, { recursive: true, force: true }); });
  const session = await call(base, '/api/collector/groups');
  const response = await call(base, '/api/collector/drafts', { method: 'POST', cookie: session.cookie, body: draftForm(Buffer.from('not-an-image')) });
  assert.equal(response.response.status, 415);
  assert.equal(response.payload.code, 'INVALID_IMAGE');
});
