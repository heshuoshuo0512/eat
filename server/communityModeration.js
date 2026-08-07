import { createHash, randomUUID } from 'node:crypto';

export const COMMUNITY_MODERATION_VERSION = 'local-rules-2026.08.1';

const DEFAULT_BLOCKED_TERMS = ['诈骗', '赌博', '代开发票', '违禁品'];
const TARGET_TABLES = Object.freeze({ post: 'campus_posts', review: 'reviews', comment: 'post_comments' });

export function normalizeModerationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function configuredRules(env = process.env) {
  if (String(env.COMMUNITY_MODERATION_RULES_INVALID || '') === '1') return null;
  const extra = String(env.COMMUNITY_BLOCKED_TERMS || '')
    .split(',')
    .map((item) => normalizeModerationText(item))
    .filter(Boolean);
  return { blockedTerms: [...new Set([...DEFAULT_BLOCKED_TERMS, ...extra])] };
}

function staticReasonCodes(content, rules) {
  const compact = content.replace(/\s+/gu, '');
  const reasons = [];
  if (rules.blockedTerms.some((term) => compact.toLocaleLowerCase().includes(term.replace(/\s+/gu, '').toLocaleLowerCase()))) reasons.push('BLOCKED_TERM');
  if (/(?:https?:\/\/|www\.)\S+/iu.test(content)) reasons.push('EXTERNAL_LINK');
  if (/(?:微信|vx|v信|加我|联系我)\s*[:：]?[a-z0-9_-]{5,}/iu.test(content)) reasons.push('EXTERNAL_CONTACT');
  if (/(.)\1{11,}/u.test(compact)) reasons.push('REPEATED_CHARACTERS');
  return [...new Set(reasons)];
}

async function behavioralReasonCodes(db, user, targetType, content, excludeTargetId = '') {
  const table = TARGET_TABLES[targetType];
  if (!table || !user?.id) return [];
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const recentCount = Number((await db.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND user_id = ? AND created_at >= ?`
  ).get(tenantId, user.id, oneMinuteAgo))?.count || 0);
  const duplicate = await db.prepare(
    `SELECT id, content FROM ${table} WHERE tenant_id = ? AND user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20`
  ).all(tenantId, user.id, tenMinutesAgo);
  const normalized = normalizeModerationText(content).toLocaleLowerCase();
  const repeated = duplicate.some((row) => row.id !== excludeTargetId && normalizeModerationText(row.content).toLocaleLowerCase() === normalized);
  return [...(recentCount >= 5 ? ['RATE_LIMITED'] : []), ...(repeated ? ['DUPLICATE_CONTENT'] : [])];
}

export async function moderateCommunityContent(db, user, {
  targetType,
  targetId = null,
  content,
  excludeTargetId = '',
} = {}) {
  const startedAt = Date.now();
  const normalizedContent = normalizeModerationText(content);
  const rules = configuredRules();
  let outcome = 'pending';
  let reasonCodes = ['RULES_UNAVAILABLE'];
  if (rules) {
    reasonCodes = [
      ...staticReasonCodes(normalizedContent, rules),
      ...(await behavioralReasonCodes(db, user, targetType, normalizedContent, excludeTargetId)),
    ];
    outcome = reasonCodes.length ? 'rejected' : 'approved';
  }
  const decision = {
    id: `moderation-${randomUUID()}`,
    tenantId: user?.tenant_id || user?.tenantId || 'default',
    targetType,
    targetId,
    userId: user?.id || null,
    inputHash: createHash('sha256').update(normalizedContent).digest('hex'),
    outcome,
    reasonCodes: [...new Set(reasonCodes)],
    ruleVersion: COMMUNITY_MODERATION_VERSION,
    durationMs: Math.max(0, Date.now() - startedAt),
    normalizedContent,
  };
  return decision;
}

export async function saveModerationDecision(db, decision) {
  await db.prepare(`INSERT INTO community_moderation_decisions
    (id, tenant_id, target_type, target_id, user_id, input_hash, outcome, reason_codes_json, rule_version, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(decision.id, decision.tenantId, decision.targetType, decision.targetId, decision.userId,
      decision.inputHash, decision.outcome, JSON.stringify(decision.reasonCodes), decision.ruleVersion,
      decision.durationMs, new Date().toISOString());
  return decision;
}

export function moderationPublicResult(decision) {
  return {
    status: decision.outcome,
    ruleVersion: decision.ruleVersion,
    reasonCodes: decision.outcome === 'approved' ? [] : decision.reasonCodes,
  };
}
