import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Source loading                                                     */
/* ------------------------------------------------------------------ */

const appVue = readFileSync(resolve('src/App.vue'), 'utf-8');
const routerJs = readFileSync(resolve('src/router/index.js'), 'utf-8');

/**
 * Parse the roleFeatures object from App.vue source text.
 * Uses eval of the literal — safe because it only contains Set constructors.
 */
function extractRoleFeatures(source) {
  const marker = 'const roleFeatures = {';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  let end = start;
  for (let i = start + marker.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const code = source.slice(start + marker.length - 1, end);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${code}`)();
}

const roleFeatures = extractRoleFeatures(appVue);

/* ================================================================== */
/*  Role nav separation                                                */
/* ================================================================== */
describe('Role navigation separation (App.vue roleFeatures)', () => {
  it('student role contains only the student feature', () => {
    assert.ok(roleFeatures, 'roleFeatures extracted from source');
    const student = roleFeatures.student;
    assert.ok(student instanceof Set, 'student features is a Set');
    assert.equal(student.size, 1, 'student has exactly one feature');
    assert.ok(student.has('student'), 'student feature is "student"');
  });

  it('student role is excluded from every admin/nav feature', () => {
    const forbidden = ['operations', 'orders_console', 'order_analytics', 'data_input', 'data_manage', 'ai_config', 'agent'];
    const student = roleFeatures.student;
    for (const feature of forbidden) {
      assert.ok(!student.has(feature), `student must not have "${feature}"`);
    }
  });

  it('every admin-type role excludes the student feature', () => {
    const adminRoles = ['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin'];
    for (const role of adminRoles) {
      const features = roleFeatures[role];
      assert.ok(features instanceof Set, `${role} has a feature Set`);
      assert.ok(!features.has('student'), `${role} must not include "student" feature`);
    }
  });

  it('student nav items and admin nav items share no features', () => {
    const student = roleFeatures.student;
    const adminSample = roleFeatures.admin;
    for (const feature of student) {
      assert.ok(!adminSample.has(feature), `admin must not have student feature "${feature}"`);
    }
    for (const feature of adminSample) {
      assert.ok(!student.has(feature), `student must not have admin feature "${feature}"`);
    }
  });
});

/* ================================================================== */
/*  Hidden raw agent traces in template                                */
/* ================================================================== */
describe('Template does not leak raw agent or auth traces', () => {
  it('no raw agent data binding in template', () => {
    // The template section ends at </template>; only check that area
    const templateEnd = appVue.indexOf('</template>');
    const template = templateEnd > -1 ? appVue.slice(0, templateEnd) : appVue;
    assert.ok(!template.includes('{{ store.agent'), 'no {{ store.agent }} binding');
    assert.ok(!template.includes('{{ store.session'), 'no {{ store.session }} binding');
  });

  it('no token or credential binding in template', () => {
    const templateEnd = appVue.indexOf('</template>');
    const template = templateEnd > -1 ? appVue.slice(0, templateEnd) : appVue;
    assert.ok(!template.includes('{{ store.user.token'), 'no token binding');
    assert.ok(!template.includes('{{ store.user.password'), 'no password binding');
    assert.ok(!template.includes('{{ store.user.password_hash'), 'no password_hash binding');
  });
});

/* ================================================================== */
/*  Router audience guard                                              */
/* ================================================================== */
describe('Router audience guard (router/index.js)', () => {
  it('student routes carry meta.audience = student', () => {
    const studentPaths = ['/canteens', '/dishes', '/rankings', '/recommend', '/orders'];
    for (const p of studentPaths) {
      const re = new RegExp(`path:\\s*'${p.replace('/', '\\/')}'[^}]*audience:\\s*'student'`);
      assert.ok(re.test(routerJs), `route ${p} should have audience: 'student'`);
    }
  });

  it('admin routes carry meta.audience = admin', () => {
    const adminPaths = ['/admin', '/stall-console', '/order-analytics', '/agent'];
    for (const p of adminPaths) {
      const re = new RegExp(`path:\\s*'${p.replace('/', '\\/')}'[^}]*audience:\\s*'admin'`);
      assert.ok(re.test(routerJs), `route ${p} should have audience: 'admin'`);
    }
  });

  it('router beforeEach redirects non-admin away from admin routes', () => {
    assert.ok(
      routerJs.includes("to.meta.audience === 'admin'") && routerJs.includes('!isAdmin'),
      'guard blocks non-admin users from admin routes'
    );
  });

  it('router beforeEach redirects admin away from student routes', () => {
    assert.ok(
      routerJs.includes("to.meta.audience === 'student'") && routerJs.includes('isAdmin'),
      'guard blocks admin users from student routes'
    );
  });

  it('adminRoles set excludes student', () => {
    const match = routerJs.match(/const adminRoles = new Set\(\[([^\]]+)\]\)/);
    assert.ok(match, 'adminRoles Set found');
    const roles = match[1].split(',').map((r) => r.trim().replace(/['"]/g, ''));
    assert.ok(!roles.includes('student'), 'student must not be in adminRoles');
    // Every listed admin role should also exist in roleFeatures
    for (const role of roles) {
      assert.ok(roleFeatures[role], `adminRoles entry "${role}" has roleFeatures mapping`);
    }
  });
});
