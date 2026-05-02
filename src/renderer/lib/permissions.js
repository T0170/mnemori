/**
 * Role-based permissions for Mnemori.
 *
 * Three roles: owner > admin > member.
 * Unauthenticated users are owners — full local control.
 * Org members get permissions from their org role.
 */

const CAPABILITIES = {
  // Recording & content — all roles
  'recording:create':    ['owner', 'admin', 'member'],
  'recording:view_own':  ['owner', 'admin', 'member'],
  'recording:delete_own':['owner', 'admin', 'member'],
  'recording:view_all':  ['owner', 'admin'],

  // Pipeline — all roles
  'pipeline:transcribe': ['owner', 'admin', 'member'],
  'pipeline:generate':   ['owner', 'admin', 'member'],

  // User settings — all roles
  'settings:audio':      ['owner', 'admin', 'member'],
  'settings:hotkey':     ['owner', 'admin', 'member'],
  'settings:auto_pipeline': ['owner', 'admin', 'member'],

  // Admin settings
  'settings:api_keys':   ['owner', 'admin'],
  'settings:retention':  ['owner', 'admin'],
  'settings:storage_path': ['owner', 'admin'],
  'settings:org_policies': ['owner', 'admin'],
  'admin:access':        ['owner', 'admin'],

  // Concepts
  'concepts:use':        ['owner', 'admin', 'member'],
  'concepts:admin_toggle': ['owner', 'admin'],

  // Audit
  'audit:view_all':      ['owner', 'admin'],
  'audit:view_own':      ['owner', 'admin', 'member'],

  // Org management
  'org:invite':          ['owner', 'admin'],
  'org:remove_user':     ['owner', 'admin'],
  'org:assign_roles':    ['owner', 'admin'],
  'org:delete':          ['owner'],
  'org:transfer':        ['owner'],
  'org:billing':         ['owner'],
};

export function normalizeRole(role) {
  if (!role) return 'owner';
  if (role === 'org:admin') return 'admin';
  if (role === 'org:member') return 'member';
  return role;
}

export function can(role, capability) {
  const normalized = normalizeRole(role);
  const allowed = CAPABILITIES[capability];
  if (!allowed) return false;
  return allowed.includes(normalized);
}

export function canAll(role, capabilities) {
  return capabilities.every((c) => can(role, c));
}

export function canAny(role, capabilities) {
  return capabilities.some((c) => can(role, c));
}

export function getRoleName(role) {
  const n = normalizeRole(role);
  if (n === 'owner') return 'Owner';
  if (n === 'admin') return 'Admin';
  if (n === 'member') return 'Member';
  return n;
}
