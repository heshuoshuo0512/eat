import { createHash, randomUUID } from 'node:crypto';
import { observeMealFromImage } from '../server/aiProvider.js';
import { hammingDistance, normalizeCollectorImage } from './image.js';
import { deleteCollectorObject, readCollectorObject, storeCollectorObject } from './storage.js';
import { normalizeCatalogTerm, syncCollectorCatalog } from './catalog.js';

const CONSENT_VERSION = 'collector-training-v1';
const REJECTION_REASONS = new Set(['多道菜', '画面模糊', '非餐食', '错误标签', '重复图片', '包含人脸或个人信息']);

function isoNow() {
  return new Date().toISOString();
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function deterministicSecondReview(id) {
  return Number.parseInt(createHash('sha256').update(id).digest('hex').slice(0, 4), 16) % 10 === 0;
}

async function groupScope(db, groupId) {
  const group = await db.get('SELECT * FROM collector_groups WHERE id = ? AND active = 1', [groupId]);
  if (!group) throw Object.assign(new Error('采集分组不存在或未启用'), { status: 404, code: 'COLLECTOR_GROUP_NOT_FOUND' });
  const venues = await db.all('SELECT * FROM collector_catalog_venues');
  const roots = new Set((await db.all('SELECT venue_id FROM collector_group_venues WHERE group_id = ?', [groupId])).map((item) => item.venue_id));
  const allowed = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const venue of venues) {
      if (!allowed.has(venue.id) && allowed.has(venue.parent_id)) {
        allowed.add(venue.id);
        changed = true;
      }
    }
  }
  return { group, venues, allowedVenueIds: [...allowed] };
}

async function scopedDishes(db, groupId) {
  const scope = await groupScope(db, groupId);
  if (!scope.allowedVenueIds.length) return { ...scope, dishes: [] };
  const dishes = await db.all(`SELECT dish.*, stall.name AS stall_name, stall.venue_id,
      venue.name AS venue_name, venue.display_name AS venue_display_name
    FROM collector_catalog_dishes dish
    JOIN collector_catalog_stalls stall ON stall.id = dish.stall_id
    JOIN collector_catalog_venues venue ON venue.id = stall.venue_id
    WHERE dish.status = 'active' AND stall.venue_id IN (${placeholders(scope.allowedVenueIds)})`, scope.allowedVenueIds);
  return { ...scope, dishes };
}

function matchScore(dish, terms) {
  const canonical = normalizeCatalogTerm(dish.canonical_name || dish.name);
  const aliases = parseJson(dish.aliases_json, []).map(normalizeCatalogTerm);
  let score = 0;
  let matchType = '';
  for (const [index, rawTerm] of terms.entries()) {
    const term = normalizeCatalogTerm(rawTerm);
    if (!term) continue;
    const weight = index === 0 ? 1 : 0.82;
    if (canonical === term) { score = Math.max(score, weight); matchType = 'exact'; }
    else if (aliases.includes(term)) { score = Math.max(score, weight * 0.94); matchType ||= 'alias'; }
    else if (canonical.includes(term) || term.includes(canonical)) { score = Math.max(score, weight * 0.76); matchType ||= 'fuzzy'; }
    else {
      const chars = new Set(term);
      const overlap = [...new Set(canonical)].filter((char) => chars.has(char)).length;
      const similarity = overlap / Math.max(1, new Set([...canonical, ...term]).size);
      if (similarity >= 0.5) { score = Math.max(score, weight * similarity * 0.7); matchType ||= 'fuzzy'; }
    }
  }
  return { score, matchType };
}

export async function searchCollectorCatalog(db, groupId, terms, limit = 20) {
  const { dishes } = await scopedDishes(db, groupId);
  return dishes
    .map((dish) => ({ dish, ...matchScore(dish, terms) }))
    .filter((item) => item.score >= 0.28)
    .sort((left, right) => right.score - left.score || left.dish.name.localeCompare(right.dish.name, 'zh-CN'))
    .slice(0, limit)
    .map(({ dish, score, matchType }) => ({
      dishId: dish.id,
      name: dish.name,
      canonicalName: dish.canonical_name,
      stall: { id: dish.stall_id, name: dish.stall_name },
      venue: { id: dish.venue_id, name: dish.venue_display_name || dish.venue_name },
      score: Number(score.toFixed(3)),
      matchType,
    }));
}

export async function listCollectorGroups(db) {
  const groups = await db.all('SELECT * FROM collector_groups WHERE active = 1 ORDER BY display_order, name');
  const result = [];
  for (const group of groups) {
    const venues = await db.all(`SELECT venue.id, venue.name, venue.display_name
      FROM collector_group_venues mapping JOIN collector_catalog_venues venue ON venue.id = mapping.venue_id
      WHERE mapping.group_id = ? ORDER BY venue.name`, [group.id]);
    const targetRows = await db.all(`SELECT target.dish_id, target.goal_images, dish.name,
        COUNT(CASE WHEN submission.status = 'approved' THEN 1 END) AS approved_count
      FROM collector_targets target
      JOIN collector_catalog_dishes dish ON dish.id = target.dish_id
      LEFT JOIN collector_submissions submission ON submission.selected_dish_id = target.dish_id
      WHERE target.group_id = ? AND target.active = 1
      GROUP BY target.dish_id, target.goal_images, dish.name
      ORDER BY approved_count, target.priority DESC, dish.name`, [group.id]);
    const goal = targetRows.reduce((sum, item) => sum + Number(item.goal_images || 0), 0);
    const approved = targetRows.reduce((sum, item) => sum + Number(item.approved_count || 0), 0);
    result.push({
      id: group.id,
      name: group.name,
      description: group.description,
      venues: venues.map((item) => ({ id: item.id, name: item.display_name || item.name })),
      progress: { approved, goal, percent: goal ? Math.min(100, Math.round(approved / goal * 100)) : 0 },
      neededDishes: targetRows.slice(0, 6).map((item) => ({ id: item.dish_id, name: item.name, approved: Number(item.approved_count || 0), goal: Number(item.goal_images) })),
    });
  }
  return result;
}

async function findNearDuplicate(db, phash) {
  const rows = await db.all(`SELECT object.id, object.phash, submission.id AS submission_id
    FROM collector_objects object
    LEFT JOIN collector_submissions submission ON submission.object_id = object.id
    WHERE submission.status IS NULL OR submission.status NOT IN ('withdrawn','expired')
    ORDER BY object.created_at DESC LIMIT 2000`);
  return rows.find((item) => hammingDistance(phash, item.phash) <= 5) || null;
}

async function visionNames(image, filename) {
  try {
    const observation = await observeMealFromImage({
      filename,
      contentType: image.contentType,
      dataBase64: image.buffer.toString('base64'),
      mode: 'single_dish',
      context: { mealType: 'lunch', capturedAt: isoNow() },
      portion: { size: 'regular' },
    });
    return {
      names: [...new Set((observation.genericNames || []).map(String).filter(Boolean))].slice(0, 5),
      warning: observation.multipleItems ? '检测到多道菜，建议只保留一道菜作为画面主体。' : observation.quality?.usable === false ? '图片质量较低，请考虑重新拍摄。' : '',
    };
  } catch (error) {
    return { names: [], warning: '', aiError: error.message };
  }
}

export async function createCollectorDraft({ db, contributor, groupId, claimedName, requestAiSuggestion = true, file }) {
  const name = String(claimedName || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('请填写菜品名称'), { status: 400, code: 'DISH_NAME_REQUIRED' });
  await groupScope(db, groupId);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const count = Number((await db.get(`SELECT COUNT(*) AS count FROM collector_submissions
    WHERE contributor_id = ? AND created_at >= ? AND status <> 'withdrawn'`, [contributor.id, dayAgo]))?.count || 0);
  if (count >= 5) throw Object.assign(new Error('今天已经提交 5 张图片，请明天再来'), { status: 429, code: 'CONTRIBUTOR_DAILY_LIMIT' });

  const image = await normalizeCollectorImage(file.buffer);
  const exact = await db.get(`SELECT submission.id FROM collector_objects object
    LEFT JOIN collector_submissions submission ON submission.object_id = object.id
    WHERE object.sha256 = ? AND (submission.status IS NULL OR submission.status NOT IN ('withdrawn','expired')) LIMIT 1`, [image.sha256]);
  if (exact) throw Object.assign(new Error('这张图片已经提交过'), { status: 409, code: 'DUPLICATE_IMAGE', duplicateSubmissionId: exact.id });
  const near = await findNearDuplicate(db, image.phash);
  const objectId = `collector-object-${randomUUID()}`;
  const stored = await storeCollectorObject({ contributorId: contributor.id, objectId, buffer: image.buffer });
  const createdAt = isoNow();
  await db.run(`INSERT INTO collector_objects
    (id, contributor_id, filename, content_type, size_bytes, storage_provider, storage_key, sha256, phash, width, height, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    objectId, contributor.id, String(file.filename || 'meal.jpg').slice(0, 180), image.contentType, image.buffer.length,
    stored.provider, stored.key, image.sha256, image.phash, image.width, image.height, createdAt,
  ]);

  const vision = requestAiSuggestion
    ? await visionNames(image, file.filename || 'meal.jpg')
    : { names: [], warning: '', aiError: '' };
  const candidates = await searchCollectorCatalog(db, groupId, [name, ...vision.names]);
  const submissionId = `collector-submission-${randomUUID()}`;
  await db.run(`INSERT INTO collector_submissions
    (id, contributor_id, group_id, object_id, claimed_name, ai_names_json, candidate_ids_json,
      selected_dish_id, status, duplicate_of, needs_second_review, review_stage, rejection_reason,
      consent_version, consent_at, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?, 0, '', '', NULL, ?, ?, ?)`, [
    submissionId, contributor.id, groupId, objectId, name, JSON.stringify(vision.names),
    JSON.stringify(candidates.map((item) => item.dishId)), near?.submission_id || null,
    deterministicSecondReview(submissionId) ? 1 : 0, addDays(createdAt, 1), createdAt, createdAt,
  ]);
  return {
    id: submissionId,
    status: 'draft',
    imageUrl: `/api/collector/objects/${encodeURIComponent(objectId)}`,
    claimedName: name,
    aiNames: vision.names,
    aiSuggestionStatus: requestAiSuggestion ? (vision.names.length ? 'available' : 'unavailable') : 'skipped',
    aiUnavailableReason: vision.aiError || '',
    warning: vision.warning || (near ? '检测到外观相近的历史图片，提交后将由审核员检查。' : ''),
    nearDuplicate: Boolean(near),
    candidates,
    expiresAt: addDays(createdAt, 1),
  };
}

export async function confirmCollectorDraft({ db, contributor, submissionId, dishId, consent, consentVersion }) {
  const submission = await db.get('SELECT * FROM collector_submissions WHERE id = ? AND contributor_id = ?', [submissionId, contributor.id]);
  if (!submission) throw Object.assign(new Error('草稿不存在'), { status: 404, code: 'COLLECTOR_DRAFT_NOT_FOUND' });
  if (submission.status !== 'draft') throw Object.assign(new Error('该草稿已经确认或失效'), { status: 409, code: 'COLLECTOR_DRAFT_ALREADY_CONFIRMED' });
  if (new Date(submission.expires_at).getTime() <= Date.now()) throw Object.assign(new Error('草稿已过期'), { status: 410, code: 'COLLECTOR_DRAFT_EXPIRED' });
  if (consent !== true || consentVersion !== CONSENT_VERSION) throw Object.assign(new Error('提交训练图片前需要确认数据授权'), { status: 400, code: 'COLLECTOR_CONSENT_REQUIRED' });
  let selectedDishId = String(dishId || '').trim() || null;
  if (selectedDishId) {
    const scope = await scopedDishes(db, submission.group_id);
    if (!scope.dishes.some((item) => item.id === selectedDishId)) {
      throw Object.assign(new Error('所选菜品不属于当前采集分组'), { status: 400, code: 'DISH_OUT_OF_GROUP_SCOPE' });
    }
  }
  const timestamp = isoNow();
  const status = selectedDishId ? 'pending_review' : 'needs_mapping';
  await db.run(`UPDATE collector_submissions SET selected_dish_id = ?, status = ?, review_stage = 1,
    consent_version = ?, consent_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`, [
    selectedDishId, status, consentVersion, timestamp, addDays(timestamp, 30), timestamp, submission.id,
  ]);
  return { id: submission.id, status, selectedDishId, pointsPending: true };
}

export async function contributorSummary(db, contributor) {
  const points = Number((await db.get('SELECT COALESCE(SUM(delta), 0) AS points FROM collector_points WHERE contributor_id = ?', [contributor.id]))?.points || 0);
  const rows = await db.all(`SELECT submission.id, submission.claimed_name, submission.status, submission.selected_dish_id,
      submission.rejection_reason, submission.created_at, submission.updated_at, object.id AS object_id,
      dish.name AS dish_name, stall.name AS stall_name, venue.name AS venue_name,
      COALESCE(SUM(points.delta), 0) AS points
    FROM collector_submissions submission
    JOIN collector_objects object ON object.id = submission.object_id
    LEFT JOIN collector_catalog_dishes dish ON dish.id = submission.selected_dish_id
    LEFT JOIN collector_catalog_stalls stall ON stall.id = dish.stall_id
    LEFT JOIN collector_catalog_venues venue ON venue.id = stall.venue_id
    LEFT JOIN collector_points points ON points.submission_id = submission.id
    WHERE submission.contributor_id = ?
    GROUP BY submission.id, submission.claimed_name, submission.status, submission.selected_dish_id,
      submission.rejection_reason, submission.created_at, submission.updated_at, object.id,
      dish.name, stall.name, venue.name
    ORDER BY submission.created_at DESC LIMIT 100`, [contributor.id]);
  return {
    points,
    consentVersion: CONSENT_VERSION,
    dailyLimit: 5,
    submissions: rows.map((item) => ({
      id: item.id,
      claimedName: item.claimed_name,
      status: item.status,
      imageUrl: `/api/collector/objects/${encodeURIComponent(item.object_id)}`,
      dish: item.selected_dish_id ? { id: item.selected_dish_id, name: item.dish_name, stall: item.stall_name, venue: item.venue_name } : null,
      rejectionReason: item.rejection_reason,
      points: Number(item.points || 0),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
  };
}

export async function withdrawSubmission(db, contributor, submissionId) {
  const submission = await db.get(`SELECT submission.*, object.storage_provider, object.storage_key
    FROM collector_submissions submission JOIN collector_objects object ON object.id = submission.object_id
    WHERE submission.id = ? AND submission.contributor_id = ?`, [submissionId, contributor.id]);
  if (!submission) throw Object.assign(new Error('提交记录不存在'), { status: 404, code: 'COLLECTOR_SUBMISSION_NOT_FOUND' });
  if (['withdrawn', 'expired'].includes(submission.status)) return { id: submission.id, status: submission.status };
  const timestamp = isoNow();
  await db.transaction(async (tx) => {
    const earned = Number((await tx.get('SELECT COALESCE(SUM(delta), 0) AS points FROM collector_points WHERE submission_id = ?', [submission.id]))?.points || 0);
    if (earned > 0) {
      await tx.run(`INSERT INTO collector_points(id, contributor_id, submission_id, delta, reason, created_at)
        VALUES (?, ?, ?, ?, 'withdrawal_reversal', ?) ON CONFLICT(submission_id, reason) DO NOTHING`, [
        `collector-points-${randomUUID()}`, contributor.id, submission.id, -earned, timestamp,
      ]);
    }
    await tx.run(`UPDATE collector_submissions SET status = 'withdrawn', expires_at = ?, updated_at = ? WHERE id = ?`, [timestamp, timestamp, submission.id]);
  });
  await deleteCollectorObject({ storageProvider: submission.storage_provider, storageKey: submission.storage_key });
  return { id: submission.id, status: 'withdrawn' };
}

export async function readAuthorizedObject(db, { objectId, contributor, staff }) {
  const object = await db.get('SELECT * FROM collector_objects WHERE id = ?', [objectId]);
  if (!object) throw Object.assign(new Error('图片不存在'), { status: 404, code: 'COLLECTOR_OBJECT_NOT_FOUND' });
  if (!staff && object.contributor_id !== contributor?.id) throw Object.assign(new Error('无权查看该图片'), { status: 403, code: 'COLLECTOR_OBJECT_FORBIDDEN' });
  return { object, body: await readCollectorObject({ storageProvider: object.storage_provider, storageKey: object.storage_key }) };
}

export async function listReviewQueue(db, { status = 'pending_review', limit = 50 } = {}) {
  const bounded = Math.min(100, Math.max(1, Number(limit) || 50));
  const rows = await db.all(`SELECT submission.*, object.id AS object_id, object.sha256, object.phash,
      dish.name AS dish_name, stall.name AS stall_name, venue.name AS venue_name, group_row.name AS group_name
    FROM collector_submissions submission
    JOIN collector_objects object ON object.id = submission.object_id
    JOIN collector_groups group_row ON group_row.id = submission.group_id
    LEFT JOIN collector_catalog_dishes dish ON dish.id = submission.selected_dish_id
    LEFT JOIN collector_catalog_stalls stall ON stall.id = dish.stall_id
    LEFT JOIN collector_catalog_venues venue ON venue.id = stall.venue_id
    WHERE submission.status = ? ORDER BY submission.created_at LIMIT ?`, [status, bounded]);
  return rows.map((item) => ({
    id: item.id,
    groupId: item.group_id,
    status: item.status,
    reviewStage: item.review_stage,
    needsSecondReview: Boolean(item.needs_second_review),
    group: item.group_name,
    claimedName: item.claimed_name,
    aiNames: parseJson(item.ai_names_json, []),
    imageUrl: `/api/collector/objects/${encodeURIComponent(item.object_id)}`,
    selectedDish: item.selected_dish_id ? { id: item.selected_dish_id, name: item.dish_name, stall: item.stall_name, venue: item.venue_name } : null,
    duplicateFlag: Boolean(item.duplicate_of),
    createdAt: item.created_at,
  }));
}

async function awardPoints(tx, submission, timestamp) {
  const target = submission.selected_dish_id
    ? await tx.get('SELECT goal_images FROM collector_targets WHERE group_id = ? AND dish_id = ? AND active = 1', [submission.group_id, submission.selected_dish_id])
    : null;
  const approved = submission.selected_dish_id
    ? Number((await tx.get(`SELECT COUNT(*) AS count FROM collector_submissions WHERE selected_dish_id = ? AND status = 'approved'`, [submission.selected_dish_id]))?.count || 0)
    : 0;
  const shortageBonus = target && approved < Number(target.goal_images) ? 5 : 0;
  await tx.run(`INSERT INTO collector_points(id, contributor_id, submission_id, delta, reason, created_at)
    VALUES (?, ?, ?, ?, 'approval', ?) ON CONFLICT(submission_id, reason) DO NOTHING`, [
    `collector-points-${randomUUID()}`, submission.contributor_id, submission.id, 10 + shortageBonus, timestamp,
  ]);
}

async function finalizeReview(tx, submission, { approved, dishId, reason }, timestamp) {
  if (approved) {
    await tx.run(`UPDATE collector_submissions SET status = 'approved', selected_dish_id = ?, review_stage = 0,
      rejection_reason = '', expires_at = ?, updated_at = ? WHERE id = ?`, [dishId, addDays(timestamp, 365), timestamp, submission.id]);
    await awardPoints(tx, { ...submission, selected_dish_id: dishId }, timestamp);
  } else {
    await tx.run(`UPDATE collector_submissions SET status = 'rejected', review_stage = 0,
      rejection_reason = ?, expires_at = ?, updated_at = ? WHERE id = ?`, [reason, addDays(timestamp, 30), timestamp, submission.id]);
  }
}

export async function reviewSubmission({ db, staff, submissionId, action, dishId, reason }) {
  const submission = await db.get('SELECT * FROM collector_submissions WHERE id = ?', [submissionId]);
  if (!submission || !['pending_review', 'needs_mapping'].includes(submission.status)) {
    throw Object.assign(new Error('待审记录不存在'), { status: 404, code: 'REVIEW_SUBMISSION_NOT_FOUND' });
  }
  const decision = String(action || '');
  if (!['approve', 'relabel', 'reject', 'map'].includes(decision)) throw Object.assign(new Error('审核动作无效'), { status: 400, code: 'INVALID_REVIEW_ACTION' });
  if (decision === 'reject' && !REJECTION_REASONS.has(String(reason || ''))) {
    throw Object.assign(new Error('请选择规定的驳回原因'), { status: 400, code: 'INVALID_REJECTION_REASON' });
  }
  const selectedDishId = ['approve', 'relabel', 'map'].includes(decision) ? String(dishId || submission.selected_dish_id || '').trim() : null;
  if (!selectedDishId && decision !== 'reject') throw Object.assign(new Error('通过或改标时必须选择菜品'), { status: 400, code: 'REVIEW_DISH_REQUIRED' });
  if (selectedDishId) {
    const scope = await scopedDishes(db, submission.group_id);
    if (!scope.dishes.some((item) => item.id === selectedDishId)) throw Object.assign(new Error('审核菜品不属于当前分组'), { status: 400, code: 'REVIEW_DISH_OUT_OF_SCOPE' });
  }
  const previous = await db.all('SELECT * FROM collector_reviews WHERE submission_id = ? ORDER BY stage', [submission.id]);
  if (previous.some((item) => item.reviewer_id === staff.id)) throw Object.assign(new Error('复审必须由另一位审核员完成'), { status: 409, code: 'SECOND_REVIEWER_REQUIRED' });
  const stage = submission.review_stage >= 3 ? 3 : previous.length + 1;
  if (stage >= 3 && staff.role !== 'collector_admin') throw Object.assign(new Error('审核冲突需要管理员裁决'), { status: 403, code: 'REVIEW_CONFLICT_ADMIN_REQUIRED' });
  const timestamp = isoNow();
  await db.transaction(async (tx) => {
    await tx.run(`INSERT INTO collector_reviews(id, submission_id, reviewer_id, stage, decision, dish_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      `collector-review-${randomUUID()}`, submission.id, staff.id, stage, decision, selectedDishId, String(reason || '').slice(0, 240), timestamp,
    ]);
    if (stage === 1 && submission.needs_second_review) {
      await tx.run(`UPDATE collector_submissions SET selected_dish_id = ?, status = 'pending_review', review_stage = 2,
        rejection_reason = ?, updated_at = ? WHERE id = ?`, [selectedDishId, decision === 'reject' ? String(reason || '') : '', timestamp, submission.id]);
      return;
    }
    if (stage === 2) {
      const first = previous[0];
      const sameOutcome = first && first.decision === decision && String(first.dish_id || '') === String(selectedDishId || '');
      if (!sameOutcome) {
        await tx.run(`UPDATE collector_submissions SET status = 'pending_review', review_stage = 3, updated_at = ? WHERE id = ?`, [timestamp, submission.id]);
        return;
      }
    }
    await finalizeReview(tx, submission, { approved: decision !== 'reject', dishId: selectedDishId, reason: String(reason || '') }, timestamp);
  });
  return db.get('SELECT id, status, selected_dish_id, review_stage, rejection_reason FROM collector_submissions WHERE id = ?', [submission.id]);
}

export async function collectorAdminState(db) {
  const groups = await db.all('SELECT * FROM collector_groups ORDER BY display_order, name');
  const venues = await db.all('SELECT * FROM collector_catalog_venues ORDER BY name');
  const mappings = await db.all('SELECT * FROM collector_group_venues');
  const targets = await db.all(`SELECT target.group_id, target.dish_id, target.goal_images, target.priority,
      dish.name, dish.canonical_name, stall.name AS stall_name, venue.name AS venue_name,
      COUNT(CASE WHEN submission.status = 'approved' THEN 1 END) AS approved_count,
      COUNT(DISTINCT CASE WHEN submission.status = 'approved' THEN submission.contributor_id END) AS contributor_count
    FROM collector_targets target
    JOIN collector_catalog_dishes dish ON dish.id = target.dish_id
    JOIN collector_catalog_stalls stall ON stall.id = dish.stall_id
    JOIN collector_catalog_venues venue ON venue.id = stall.venue_id
    LEFT JOIN collector_submissions submission ON submission.selected_dish_id = target.dish_id
    WHERE target.active = 1
    GROUP BY target.group_id, target.dish_id, target.goal_images, target.priority,
      dish.name, dish.canonical_name, stall.name, venue.name
    ORDER BY target.group_id, target.priority DESC, dish.name`);
  const catalogVersion = (await db.get("SELECT value FROM collector_catalog_meta WHERE key = 'version'"))?.value || '';
  return {
    catalogVersion,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      displayOrder: group.display_order,
      active: Boolean(group.active),
      venueIds: mappings.filter((item) => item.group_id === group.id).map((item) => item.venue_id),
      targets: targets.filter((item) => item.group_id === group.id).map((item) => ({
        dishId: item.dish_id,
        name: item.name,
        canonicalName: item.canonical_name,
        stall: item.stall_name,
        venue: item.venue_name,
        goalImages: Number(item.goal_images),
        priority: Number(item.priority),
        approved: Number(item.approved_count),
        contributors: Number(item.contributor_count),
      })),
    })),
    venues: venues.map((venue) => ({ id: venue.id, name: venue.display_name || venue.name, parentId: venue.parent_id, kind: venue.venue_kind })),
  };
}

export async function updateCollectorGroup(db, groupId, body) {
  const group = await db.get('SELECT * FROM collector_groups WHERE id = ?', [groupId]);
  if (!group) throw Object.assign(new Error('采集分组不存在'), { status: 404, code: 'COLLECTOR_GROUP_NOT_FOUND' });
  const venueIds = [...new Set((body.venueIds || []).map(String).filter(Boolean))];
  const conflicts = venueIds.length ? await db.all(`SELECT group_id, venue_id FROM collector_group_venues
    WHERE group_id <> ? AND venue_id IN (${placeholders(venueIds)})`, [groupId, ...venueIds]) : [];
  if (conflicts.length) throw Object.assign(new Error('同一餐饮区不能同时属于多个采集分组'), { status: 409, code: 'COLLECTOR_VENUE_GROUP_CONFLICT', conflicts });
  const timestamp = isoNow();
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE collector_groups SET name = ?, description = ?, display_order = ?, active = ?, updated_at = ? WHERE id = ?`, [
      String(body.name || group.name).trim().slice(0, 60), String(body.description ?? group.description).trim().slice(0, 240),
      Number(body.displayOrder ?? group.display_order), body.active === false ? 0 : 1, timestamp, groupId,
    ]);
    await tx.run('DELETE FROM collector_group_venues WHERE group_id = ?', [groupId]);
    for (const venueId of venueIds) await tx.run('INSERT INTO collector_group_venues(group_id, venue_id) VALUES (?, ?)', [groupId, venueId]);
  });
  return collectorAdminState(db);
}

export async function updateCollectorTargets(db, groupId, targets) {
  await groupScope(db, groupId);
  const scope = await scopedDishes(db, groupId);
  const allowed = new Set(scope.dishes.map((item) => item.id));
  const normalized = (targets || []).map((item) => ({ dishId: String(item.dishId || ''), goalImages: Math.max(20, Math.min(200, Number(item.goalImages) || 60)), priority: Number(item.priority || 0) }));
  if (normalized.some((item) => !allowed.has(item.dishId))) throw Object.assign(new Error('目标菜品必须属于当前分组'), { status: 400, code: 'TARGET_DISH_OUT_OF_SCOPE' });
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM collector_targets WHERE group_id = ?', [groupId]);
    for (const item of normalized.slice(0, 200)) {
      await tx.run('INSERT INTO collector_targets(group_id, dish_id, goal_images, priority, active) VALUES (?, ?, ?, ?, 1)', [groupId, item.dishId, item.goalImages, item.priority]);
    }
  });
  return listCollectorGroups(db);
}

export async function cleanupCollectorData(db) {
  const timestamp = isoNow();
  const rows = await db.all(`SELECT submission.id, submission.status, object.storage_provider, object.storage_key
    FROM collector_submissions submission JOIN collector_objects object ON object.id = submission.object_id
    WHERE submission.expires_at <= ? AND submission.status NOT IN ('withdrawn','expired')`, [timestamp]);
  for (const row of rows) {
    await deleteCollectorObject({ storageProvider: row.storage_provider, storageKey: row.storage_key });
    await db.run(`UPDATE collector_submissions SET status = 'expired', updated_at = ? WHERE id = ?`, [timestamp, row.id]);
  }
  await db.run('DELETE FROM collector_staff_sessions WHERE expires_at <= ?', [timestamp]);
  return { expired: rows.length };
}

export { CONSENT_VERSION, syncCollectorCatalog };
