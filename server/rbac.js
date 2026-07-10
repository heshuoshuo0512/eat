const studentPermissions = ['review:create', 'profile:write', 'upload:create', 'agent:use', 'preference:write'];
const operatorPermissions = [...studentPermissions, 'dish:write', 'dish:bulk_import', 'stall:write'];
const stallAdminPermissions = [...operatorPermissions, 'dish:delete', 'stall:delete'];
const canteenAdminPermissions = [...stallAdminPermissions, 'canteen:write', 'audit:read', 'user:read', 'review:moderate', 'environment:write'];
const tenantAdminPermissions = [...canteenAdminPermissions, 'canteen:delete', 'user:write', 'ai:configure'];
const superAdminPermissions = [...tenantAdminPermissions, 'tenant:manage'];

export const rolePermissions = {
  student: new Set(studentPermissions),
  operator: new Set(operatorPermissions),
  stall_admin: new Set(stallAdminPermissions),
  canteen_admin: new Set(canteenAdminPermissions),
  tenant_admin: new Set(tenantAdminPermissions),
  auditor: new Set(['audit:read', 'user:read']),
  finance: new Set(['audit:read']),
  admin: new Set(superAdminPermissions),
  super_admin: new Set(superAdminPermissions)
};

export const assignableRoles = new Set(['student', 'operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin']);

export function hasPermission(user, permission) {
  return Boolean(user && rolePermissions[user.role]?.has(permission));
}

export function requirePermission(user, permission) {
  if (!user) throw Object.assign(new Error('请先登录'), { status: 401 });
  if (!hasPermission(user, permission)) throw Object.assign(new Error('权限不足'), { status: 403 });
  return user;
}
