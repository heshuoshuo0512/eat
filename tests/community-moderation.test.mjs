import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import { moderateCommunityContent, normalizeModerationText } from '../server/communityModeration.js';

const originalInvalidRules = process.env.COMMUNITY_MODERATION_RULES_INVALID;
const originalBlockedTerms = process.env.COMMUNITY_BLOCKED_TERMS;

afterEach(() => {
  if (originalInvalidRules == null) delete process.env.COMMUNITY_MODERATION_RULES_INVALID;
  else process.env.COMMUNITY_MODERATION_RULES_INVALID = originalInvalidRules;
  if (originalBlockedTerms == null) delete process.env.COMMUNITY_BLOCKED_TERMS;
  else process.env.COMMUNITY_BLOCKED_TERMS = originalBlockedTerms;
});

function fixture() {
  const db = openDatabase(':memory:');
  const user = db.prepare("SELECT * FROM users WHERE tenant_id = 'default' AND role = 'student' LIMIT 1").get();
  return { db, user };
}

describe('synchronous community moderation rules', () => {
  it('normalizes compatibility characters, zero-width text, and whitespace', () => {
    assert.equal(normalizeModerationText('  Ａ\u200BＢ  \n C  '), 'AB C');
  });

  it('approves valid content and rejects configured blocked terms', async () => {
    const { db, user } = fixture();
    try {
      const valid = await moderateCommunityContent(db, user, { targetType: 'review', targetId: 'valid', content: '正常的校园餐饮评价' });
      assert.equal(valid.outcome, 'approved');

      process.env.COMMUNITY_BLOCKED_TERMS = '禁止发布词';
      const blocked = await moderateCommunityContent(db, user, { targetType: 'review', targetId: 'blocked', content: '这里包含禁\u200B止发布词' });
      assert.equal(blocked.outcome, 'rejected');
      assert.ok(blocked.reasonCodes.includes('BLOCKED_TERM'));
    } finally {
      db.close();
    }
  });

  it('keeps content pending when moderation rules cannot load', async () => {
    const { db, user } = fixture();
    process.env.COMMUNITY_MODERATION_RULES_INVALID = '1';
    try {
      const decision = await moderateCommunityContent(db, user, { targetType: 'post', targetId: 'pending', content: '规则故障时不能直接公开' });
      assert.equal(decision.outcome, 'pending');
      assert.deepEqual(decision.reasonCodes, ['RULES_UNAVAILABLE']);
    } finally {
      db.close();
    }
  });

  it('rejects duplicate content and short-window flooding', async () => {
    const { db, user } = fixture();
    const timestamp = new Date().toISOString();
    try {
      for (let index = 0; index < 5; index += 1) {
        db.prepare(`INSERT INTO reviews (id, tenant_id, user_id, target_type, target_id, rating, content, status, created_at)
          VALUES (?, 'default', ?, 'dish', 'd-chicken-bowl', 4, ?, 'approved', ?)`).run(`moderation-fixture-${index}`, user.id, index === 0 ? '重复评价内容' : `普通评价 ${index}`, timestamp);
      }
      const decision = await moderateCommunityContent(db, user, { targetType: 'review', targetId: 'new-review', content: '重复评价内容' });
      assert.equal(decision.outcome, 'rejected');
      assert.ok(decision.reasonCodes.includes('DUPLICATE_CONTENT'));
      assert.ok(decision.reasonCodes.includes('RATE_LIMITED'));
    } finally {
      db.close();
    }
  });
});
