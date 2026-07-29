import { createHash, randomUUID } from 'node:crypto';
import { observeMealFromImage, rerankMealCandidates } from './aiProvider.js';
import { parseJson, rowToDish, serializeJson } from './database.js';
import { businessDate } from './time.js';
import { readStoredUpload } from './storage.js';
import { resolveUploadReference } from './security.js';
import { calculateRecipeNutrition, nutrientRangesFromPoints, scaleNutritionRanges, unknownNutrition } from './mealNutrition.js';
import { cosineSimilarity, createVisionImageEmbedding, getVisionEmbeddingStatus, pgVectorLiteral } from './visionEmbedding.js';

const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner']);
const PORTION_SIZES = new Set(['small', 'regular', 'large']);

function isoNow() {
  return new Date().toISOString();
}

function roundedMetric(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function warning(code, message) {
  return { code, message };
}

function normalizeContext(value = {}) {
  const capturedAt = value.capturedAt ? new Date(value.capturedAt) : new Date();
  if (Number.isNaN(capturedAt.getTime())) throw Object.assign(new Error('拍摄时间格式无效'), { status: 400, code: 'INVALID_CAPTURED_AT' });
  const mealType = String(value.mealType || 'lunch').trim();
  if (!MEAL_TYPES.has(mealType)) throw Object.assign(new Error('餐次必须是 breakfast、lunch 或 dinner'), { status: 400, code: 'INVALID_MEAL_TYPE' });
  return {
    canteenId: String(value.canteenId || '').trim(),
    stallId: String(value.stallId || '').trim() || null,
    menuId: String(value.menuId || '').trim() || null,
    capturedAt: capturedAt.toISOString(),
    date: businessDate(capturedAt),
    mealType,
  };
}

function normalizePortion(value = {}) {
  const size = PORTION_SIZES.has(String(value.size || '')) ? String(value.size) : 'regular';
  const grams = value.grams === undefined || value.grams === null || value.grams === '' ? null : Number(value.grams);
  if (grams !== null && (!Number.isFinite(grams) || grams <= 0 || grams > 3000)) {
    throw Object.assign(new Error('份量克数必须在 0-3000 克之间'), { status: 400, code: 'INVALID_PORTION_GRAMS' });
  }
  return { size, grams };
}

export function normalizeMealVisionRequest(body = {}) {
  const mode = String(body.mode || 'single_dish');
  if (mode !== 'single_dish') throw Object.assign(new Error('当前版本只支持单道菜识别'), { status: 400, code: 'UNSUPPORTED_VISION_MODE' });
  return {
    filename: String(body.filename || 'meal-image.jpg').slice(0, 180),
    contentType: String(body.contentType || '').toLowerCase(),
    dataBase64: String(body.dataBase64 || ''),
    mode,
    context: normalizeContext(body.context || {}),
    portion: normalizePortion(body.portion || {}),
  };
}

function descendants(rows, rootId, parentKey = 'parent_id') {
  const ids = new Set(rootId ? [rootId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!ids.has(row.id) && ids.has(row[parentKey])) {
        ids.add(row.id);
        changed = true;
      }
    }
  }
  return ids;
}

function ancestors(rowsById, id, parentKey = 'parent_id') {
  const path = [];
  const seen = new Set();
  let current = rowsById.get(id);
  while (current && !seen.has(current.id)) {
    path.unshift({ id: current.id, name: current.name });
    seen.add(current.id);
    current = current[parentKey] ? rowsById.get(current[parentKey]) : null;
  }
  return path;
}

function tokens(value) {
  return [...new Set(String(value || '').toLowerCase().split(/[\s，,、/()（）·\-_]+/).map((item) => item.trim()).filter(Boolean))];
}

function metadataSimilarity(observation, dish) {
  const queryNames = observation.genericNames || [];
  const queryTerms = tokens([...queryNames, ...(observation.visibleIngredients || []), ...(observation.cookingMethods || [])].join(' '));
  const candidateNames = [dish.name, ...(dish.aliases || [])].filter(Boolean);
  let score = 0;
  const reasons = [];
  if (queryNames.some((name) => candidateNames.some((candidate) => name === candidate))) {
    score += 0.55;
    reasons.push('视觉菜名与目录名称一致');
  } else if (queryNames.some((name) => candidateNames.some((candidate) => name.includes(candidate) || candidate.includes(name)))) {
    score += 0.38;
    reasons.push('视觉菜名与目录名称相近');
  }
  const candidateTerms = tokens([dish.name, ...(dish.aliases || []), ...(dish.semanticLabels || []), ...(dish.ingredients || []), ...(dish.tags || [])].join(' '));
  const overlap = queryTerms.filter((term) => candidateTerms.some((candidate) => candidate.includes(term) || term.includes(candidate)));
  if (overlap.length) {
    score += Math.min(0.4, overlap.length * 0.08);
    reasons.push(`可见特征重合：${overlap.slice(0, 4).join('、')}`);
  }
  return { score: Math.min(1, score), reasons };
}

function publicReference(row) {
  return {
    id: row.id,
    dishId: row.dish_id,
    uploadId: row.upload_id,
    purpose: row.purpose,
    angle: row.angle,
    batchKey: row.batch_key,
    qualityStatus: row.quality_status,
    imageUrl: resolveUploadReference(row.public_url),
    embeddingStatus: row.embedding_status || 'missing',
    embeddingModel: row.embedding_model || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function approvedReferences(db, tenantId, dishIds = []) {
  if (!dishIds.length) return [];
  const rows = await db.prepare(`SELECT r.*, u.public_url, u.content_type, u.storage_key, u.storage_provider,
      e.embedding_json, e.status AS embedding_status, e.model AS embedding_model
    FROM dish_reference_images r
    JOIN uploads u ON u.id = r.upload_id AND u.tenant_id = r.tenant_id
    LEFT JOIN dish_image_embeddings e ON e.reference_image_id = r.id AND e.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.purpose = 'reference' AND r.quality_status = 'approved'`).all(tenantId);
  const allowed = new Set(dishIds);
  return rows.filter((row) => allowed.has(row.dish_id));
}

export async function selectScopedVisionCandidates(db, tenantId, rawContext) {
  const context = normalizeContext(rawContext);
  const warnings = [];
  if (!context.canteenId) {
    return { context, candidates: [], warnings: [warning('VISION_CONTEXT_REQUIRED', '请选择食堂或从档口页面进入，当前只提供通用视觉观察。')], menuIds: [] };
  }

  const canteens = await db.prepare('SELECT * FROM canteens WHERE tenant_id = ?').all(tenantId);
  const canteenById = new Map(canteens.map((item) => [item.id, item]));
  if (!canteenById.has(context.canteenId)) {
    throw Object.assign(new Error('所选食堂不存在或不属于当前校园'), { status: 400, code: 'VISION_CANTEEN_NOT_FOUND' });
  }
  const canteenIds = descendants(canteens, context.canteenId);
  const menuCanteenIds = new Set(canteenIds);
  for (const item of ancestors(canteenById, context.canteenId)) menuCanteenIds.add(item.id);

  const stalls = await db.prepare('SELECT * FROM stalls WHERE tenant_id = ?').all(tenantId);
  const stallById = new Map(stalls.map((item) => [item.id, item]));
  let stallIds = new Set(stalls.filter((item) => canteenIds.has(item.canteen_id)).map((item) => item.id));
  if (context.stallId) {
    const selected = stallById.get(context.stallId);
    if (!selected || !canteenIds.has(selected.canteen_id)) {
      throw Object.assign(new Error('所选档口不属于当前食堂'), { status: 400, code: 'VISION_STALL_CONTEXT_MISMATCH' });
    }
    stallIds = descendants(stalls, context.stallId);
  }

  const menus = (await db.prepare(`SELECT * FROM menus
    WHERE tenant_id = ? AND date = ? AND meal_type = ? AND status = 'published'`).all(tenantId, context.date, context.mealType))
    .filter((item) => menuCanteenIds.has(item.canteen_id) && (!context.menuId || item.id === context.menuId));
  if (!menus.length) {
    return { context, candidates: [], warnings: [warning('NO_ACTIVE_MENU', '当前食堂没有对应日期和餐次的已发布菜单，不能判断具体校内菜品。')], menuIds: [] };
  }
  const menuIds = new Set(menus.map((item) => item.id));
  const menuItems = (await db.prepare('SELECT * FROM menu_items WHERE tenant_id = ?').all(tenantId)).filter((item) => menuIds.has(item.menu_id));
  const menuDishIds = new Set(menuItems.map((item) => item.dish_id));
  const dishes = (await db.prepare("SELECT * FROM dishes WHERE tenant_id = ? AND status = 'active'").all(tenantId))
    .filter((row) => menuDishIds.has(row.id) && stallIds.has(row.stall_id))
    .map(rowToDish);
  if (!dishes.length) warnings.push(warning('NO_SCOPED_MENU_DISHES', '已发布菜单中没有符合当前食堂或档口上下文的菜品。'));

  return {
    context,
    candidates: dishes.map((dish) => {
      const stall = stallById.get(dish.stallId);
      return {
        dish,
        canteenPath: stall ? ancestors(canteenById, stall.canteen_id) : [],
        stallPath: stall ? ancestors(stallById, stall.id) : [],
      };
    }),
    warnings,
    menuIds: [...menuIds],
  };
}

async function visualScores(db, tenantId, candidateIds, imageInput, referenceRows, warnings) {
  let queryEmbedding;
  try {
    queryEmbedding = await createVisionImageEmbedding(imageInput);
  } catch (error) {
    warnings.push(warning('VISION_EMBEDDING_FAILED', `图片向量检索暂不可用：${error.message}`));
    return new Map();
  }
  if (!queryEmbedding) {
    warnings.push(warning('VISION_EMBEDDING_NOT_CONFIGURED', '未配置 SigLIP 视觉向量服务，本次仅使用目录特征和多模态复核。'));
    return new Map();
  }

  const scores = new Map();
  if (db.isPostgres) {
    const prototypeRows = await db.query(`SELECT prototype.dish_id,
        1 - (prototype.embedding <=> $1::vector) AS similarity
      FROM dish_class_prototypes prototype
      WHERE prototype.tenant_id = $2 AND prototype.status = 'deployed'
        AND prototype.embedding IS NOT NULL AND prototype.dish_id = ANY($3::text[])
      ORDER BY prototype.embedding <=> $1::vector
      LIMIT 100`, [pgVectorLiteral(queryEmbedding.embedding), tenantId, candidateIds]);
    for (const row of prototypeRows.rows) scores.set(row.dish_id, Number(row.similarity || 0));
    const rows = await db.query(`SELECT embedding.dish_id, embedding.reference_image_id,
        1 - (embedding.embedding <=> $1::vector) AS similarity
      FROM dish_image_embeddings embedding
      JOIN dish_reference_images reference_image
        ON reference_image.id = embedding.reference_image_id
       AND reference_image.tenant_id = embedding.tenant_id
      WHERE embedding.tenant_id = $2 AND embedding.status = 'ready' AND embedding.embedding IS NOT NULL
        AND reference_image.purpose = 'reference' AND reference_image.quality_status = 'approved'
        AND embedding.dish_id = ANY($3::text[])
      ORDER BY embedding.embedding <=> $1::vector
      LIMIT 100`, [pgVectorLiteral(queryEmbedding.embedding), tenantId, candidateIds]);
    for (const row of rows.rows) scores.set(row.dish_id, Math.max(scores.get(row.dish_id) || 0, Number(row.similarity || 0)));
    return scores;
  }
  const prototypeRows = (await db.prepare(`SELECT dish_id, embedding_json FROM dish_class_prototypes
    WHERE tenant_id = ? AND status = 'deployed'`).all(tenantId)).filter((row) => candidateIds.includes(row.dish_id));
  for (const row of prototypeRows) {
    const similarity = cosineSimilarity(queryEmbedding.embedding, parseJson(row.embedding_json, null));
    if (similarity !== null) scores.set(row.dish_id, similarity);
  }
  for (const row of referenceRows) {
    const embedding = parseJson(row.embedding_json, null);
    const similarity = cosineSimilarity(queryEmbedding.embedding, embedding);
    if (similarity !== null) scores.set(row.dish_id, Math.max(scores.get(row.dish_id) || 0, similarity));
  }
  return scores;
}

function candidateResponse(item, references = []) {
  const primaryReference = references[0];
  return {
    dishId: item.dish.id,
    name: item.dish.name,
    imageUrl: item.dish.imageUrl,
    referenceImageUrl: primaryReference ? resolveUploadReference(primaryReference.public_url) : null,
    canteenPath: item.canteenPath,
    stallPath: item.stallPath,
    score: Number(item.score.toFixed(3)),
    scoreBreakdown: item.scoreBreakdown,
    reasons: item.reasons,
    price: item.dish.price,
    factStatus: item.dish.factStatus,
  };
}

async function attachReferenceImageData(rows, candidates) {
  const byDish = new Map();
  for (const row of rows) {
    if (!byDish.has(row.dish_id)) byDish.set(row.dish_id, []);
    byDish.get(row.dish_id).push(row);
  }
  const result = [];
  for (const candidate of candidates) {
    const referenceImages = [];
    for (const row of (byDish.get(candidate.dish.id) || []).slice(0, 2)) {
      try {
        const stored = await readStoredUpload(row);
        referenceImages.push({ contentType: stored.contentType, dataBase64: stored.body.toString('base64') });
      } catch {}
    }
    result.push({
      dishId: candidate.dish.id,
      name: candidate.dish.name,
      aliases: candidate.dish.aliases,
      semanticLabels: candidate.dish.semanticLabels,
      referenceImages,
    });
  }
  return result;
}

async function nutritionForDish(db, tenantId, dish, portion, visionFallback = null) {
  const row = await db.prepare(`SELECT * FROM dish_nutrition_versions
    WHERE tenant_id = ? AND dish_id = ? AND status IN ('estimated','verified')
    ORDER BY CASE status WHEN 'verified' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get(tenantId, dish.id);
  if (row) {
    return scaleNutritionRanges({
      status: row.status,
      basis: row.basis,
      portionGrams: row.portion_grams == null ? null : Number(row.portion_grams),
      ranges: parseJson(row.nutrient_ranges_json, null),
      sourceType: row.source_type,
      sourceIds: parseJson(row.source_ids_json, []),
      version: row.version,
      reason: row.status === 'verified' ? '食堂已核验营养资料。' : '根据已审核配方和食物成分参考计算。',
    }, portion);
  }
  if (['estimated', 'verified'].includes(dish.factStatus?.nutrition)) {
    const points = { ...dish.nutrition, fiber: dish.fiber, sodium: dish.sodium };
    return scaleNutritionRanges({
      status: dish.factStatus.nutrition,
      basis: 'per_serving',
      portionGrams: null,
      ranges: nutrientRangesFromPoints(points, dish.factStatus.nutrition === 'verified' ? 0 : 0.15),
      sourceType: 'manual',
      sourceIds: dish.factSource ? [dish.factSource] : [],
      version: dish.dataVersion,
      reason: dish.factStatus.nutrition === 'verified' ? '食堂已核验营养资料。' : '目录中的估算值已扩展为保守区间。',
    }, portion);
  }
  if (visionFallback?.status === 'estimated') return scaleNutritionRanges(visionFallback, portion);
  return unknownNutrition();
}

async function selectedDishResponse(db, tenantId, candidate, portion, visionFallback) {
  if (!candidate) return { selectedDish: null, nutrition: unknownNutrition('请先确认具体菜品，再显示营养结果。') };
  return {
    selectedDish: {
      id: candidate.dish.id,
      name: candidate.dish.name,
      price: candidate.dish.price,
      imageUrl: candidate.dish.imageUrl,
      canteenPath: candidate.canteenPath,
      stallPath: candidate.stallPath,
    },
    nutrition: await nutritionForDish(db, tenantId, candidate.dish, portion, visionFallback),
  };
}

export async function analyzeTrustworthyMeal({ db, user, body, model = '' }) {
  const startedAt = Date.now();
  const request = normalizeMealVisionRequest(body);
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const warnings = [];
  const scoped = await selectScopedVisionCandidates(db, tenantId, request.context);
  warnings.push(...scoped.warnings);
  const observation = await observeMealFromImage(request);

  let ranked = [];
  if (observation.multipleItems) {
    warnings.push(warning('MULTIPLE_DISHES_UNSUPPORTED', '检测到多道独立菜品，请对准一道菜重新拍摄。'));
  } else if (!observation.quality.usable) {
    warnings.push(warning('IMAGE_QUALITY_TOO_LOW', '图片质量不足，未执行具体菜品匹配。'));
  } else if (scoped.candidates.length) {
    const candidateIds = scoped.candidates.map((item) => item.dish.id);
    const references = await approvedReferences(db, tenantId, candidateIds);
    const referenceByDish = new Map();
    for (const row of references) {
      if (!referenceByDish.has(row.dish_id)) referenceByDish.set(row.dish_id, []);
      referenceByDish.get(row.dish_id).push(row);
    }
    const imageScores = await visualScores(db, tenantId, candidateIds, request, references, warnings);
    ranked = scoped.candidates.map((item) => {
      const metadata = metadataSimilarity(observation, item.dish);
      const visual = imageScores.get(item.dish.id);
      const hasVisual = Number.isFinite(visual);
      return {
        ...item,
        score: hasVisual ? Math.max(0, visual) * 0.7 + metadata.score * 0.3 : metadata.score,
        scoreBreakdown: { visual: hasVisual ? Number(visual.toFixed(3)) : null, metadata: Number(metadata.score.toFixed(3)), rerank: null },
        reasons: [...metadata.reasons, ...(hasVisual ? ['参考图视觉向量相似'] : [])],
      };
    }).sort((left, right) => right.score - left.score).slice(0, 10);

    const rerankInputs = await attachReferenceImageData(references, ranked.slice(0, 5));
    if (rerankInputs.some((item) => item.referenceImages.length)) {
      try {
        const reranked = await rerankMealCandidates({ ...request, observation, candidates: rerankInputs });
        if (reranked.multipleItems) warnings.push(warning('MULTIPLE_DISHES_UNSUPPORTED', '复核模型检测到多道独立菜品，请逐道拍摄。'));
        const byId = new Map(reranked.rankings.map((item) => [item.dishId, item]));
        ranked = ranked.map((item) => {
          const rerank = byId.get(item.dish.id);
          if (!rerank) return item;
          return {
            ...item,
            score: item.score * 0.45 + rerank.score * 0.55,
            scoreBreakdown: { ...item.scoreBreakdown, rerank: rerank.score },
            reasons: [...rerank.reasons, ...item.reasons].slice(0, 5),
          };
        }).sort((left, right) => right.score - left.score);
      } catch (error) {
        warnings.push(warning('VISION_RERANK_FAILED', `多模态候选复核暂不可用：${error.message}`));
      }
    } else {
      warnings.push(warning('REFERENCE_IMAGES_MISSING', '候选菜品尚无已审核参考图，只能提供目录特征候选。'));
    }

    ranked = ranked.filter((item) => item.score >= 0.05).slice(0, 3)
      .map((item) => ({ ...item, public: candidateResponse(item, referenceByDish.get(item.dish.id) || []) }));
  }

  const autoEnabled = process.env.VISION_AUTO_MATCH_ENABLED === '1';
  const top = ranked[0];
  const margin = top ? top.score - Number(ranked[1]?.score || 0) : 0;
  const autoMatched = Boolean(autoEnabled && top && top.score >= 0.95 && margin >= 0.12);
  const matchStatus = autoMatched ? 'auto_matched' : ranked.length ? 'needs_confirmation' : 'unresolved';
  const selected = autoMatched ? top : null;
  const resolved = await selectedDishResponse(db, tenantId, selected, request.portion, observation.estimatedNutrition);
  const analysisId = `vision-${randomUUID()}`;
  const now = isoNow();
  const responseCandidates = ranked.map((item) => item.public);
  const imageHash = createHash('sha256').update(Buffer.from(request.dataBase64, 'base64')).digest('hex');
  await db.prepare(`INSERT INTO meal_vision_analyses (
      id, tenant_id, user_id, mode, context_json, portion_json, observation_json, candidates_json,
      match_status, selected_dish_id, nutrition_json, warnings_json, model, image_hash, latency_ms,
      confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      analysisId, tenantId, user.id, request.mode, serializeJson({
        ...request.context,
        scopeDishIds: scoped.candidates.map((item) => item.dish.id),
      }), serializeJson(request.portion),
      serializeJson(observation), serializeJson(responseCandidates.map(({ referenceImageUrl, ...item }) => item)),
      matchStatus, resolved.selectedDish?.id || null, serializeJson(resolved.nutrition), serializeJson(warnings), model,
      imageHash, Date.now() - startedAt, autoMatched ? now : null, now, now,
    );
  return {
    analysisId,
    mode: request.mode,
    context: request.context,
    observation,
    match: { status: matchStatus, candidates: responseCandidates },
    ...resolved,
    warnings,
    source: {
      observation: 'vision-model',
      candidateScope: scoped.menuIds.length ? 'published-menu' : 'none',
      menuSource: scoped.menuIds.length ? 'menu' : 'none',
      visualRetrieval: getVisionEmbeddingStatus().enabled ? 'siglip' : 'degraded',
      location: 'relational-database',
      rawImageRetained: false,
      menuIds: scoped.menuIds,
    },
    suggestion: {
      name: observation.genericNames[0] || '',
      ingredients: observation.visibleIngredients,
      tags: observation.cookingMethods,
      nutrition: { calories: null, protein: null, fat: null, carbs: null },
      confidence: observation.confidence,
      notes: observation.notes,
    },
    matches: responseCandidates,
    assessment: null,
  };
}

export async function confirmMealVisionAnalysis({ db, user, analysisId, body = {} }) {
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const row = await db.prepare('SELECT * FROM meal_vision_analyses WHERE tenant_id = ? AND id = ? AND user_id = ?').get(tenantId, analysisId, user.id);
  if (!row) throw Object.assign(new Error('识别记录不存在'), { status: 404, code: 'VISION_ANALYSIS_NOT_FOUND' });
  const context = parseJson(row.context_json, {});
  const portion = normalizePortion(body.portion || parseJson(row.portion_json, {}));
  const selectedDishId = String(body.dishId || '').trim() || null;
  const originalCandidates = parseJson(row.candidates_json, []);
  const storedScopeDishIds = Array.isArray(context.scopeDishIds)
    ? context.scopeDishIds.map(String)
    : originalCandidates.map((item) => String(item.dishId || '')).filter(Boolean);
  const originalScope = new Set(storedScopeDishIds);
  let selectedCandidate = null;
  if (selectedDishId) {
    const scoped = await selectScopedVisionCandidates(db, tenantId, context);
    selectedCandidate = scoped.candidates.find((item) => item.dish.id === selectedDishId && originalScope.has(item.dish.id)) || null;
    if (!selectedCandidate) {
      throw Object.assign(new Error('所选菜品不在本次食堂和菜单范围内'), { status: 400, code: 'VISION_CONFIRMATION_OUT_OF_SCOPE' });
    }
  }
  const observation = parseJson(row.observation_json, {});
  const resolved = await selectedDishResponse(db, tenantId, selectedCandidate, portion, observation.estimatedNutrition);
  const feedbackType = !selectedDishId ? 'unresolved' : originalCandidates[0]?.dishId === selectedDishId ? 'confirmed' : 'corrected';
  const rejected = originalCandidates.map((item) => item.dishId).filter((id) => id !== selectedDishId);
  const now = isoNow();
  await db.prepare(`INSERT INTO meal_vision_feedback (
      id, tenant_id, analysis_id, user_id, feedback_type, confirmed_dish_id,
      rejected_candidate_ids_json, portion_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, analysis_id, user_id) DO UPDATE SET
      feedback_type=excluded.feedback_type, confirmed_dish_id=excluded.confirmed_dish_id,
      rejected_candidate_ids_json=excluded.rejected_candidate_ids_json,
      portion_json=excluded.portion_json, created_at=excluded.created_at`).run(
      `vision-feedback-${randomUUID()}`, tenantId, analysisId, user.id, feedbackType, selectedDishId,
      serializeJson(rejected), serializeJson(portion), now,
    );
  await db.prepare(`UPDATE meal_vision_analyses SET selected_dish_id = ?, match_status = ?,
      portion_json = ?, nutrition_json = ?, confirmed_at = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ? AND user_id = ?`).run(
      selectedDishId, selectedDishId ? 'auto_matched' : 'unresolved', serializeJson(portion),
      serializeJson(resolved.nutrition), selectedDishId ? now : null, now, tenantId, analysisId, user.id,
    );
  return {
    analysisId,
    feedbackType,
    match: { status: selectedDishId ? 'auto_matched' : 'unresolved', candidates: originalCandidates },
    ...resolved,
    portion,
    warnings: parseJson(row.warnings_json, []),
  };
}

export async function getMealVisionMetrics(db, tenantId, { days = 30 } = {}) {
  const boundedDays = Math.min(365, Math.max(1, Number(days) || 30));
  const to = new Date();
  const from = new Date(to.getTime() - boundedDays * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();
  const analyses = await db.prepare(`SELECT id, candidates_json, match_status, latency_ms, created_at
    FROM meal_vision_analyses WHERE tenant_id = ? AND created_at >= ?`).all(tenantId, fromIso);
  const feedback = await db.prepare(`SELECT analysis_id, feedback_type, confirmed_dish_id, created_at
    FROM meal_vision_feedback WHERE tenant_id = ? AND created_at >= ?`).all(tenantId, fromIso);
  const usage = await db.prepare(`SELECT status, image_count, estimated_cost, latency_ms
    FROM ai_usage_logs WHERE tenant_id = ? AND feature = 'student-vision' AND created_at >= ?`).all(tenantId, fromIso);
  const dishes = await db.prepare('SELECT id, name, stall_id FROM dishes WHERE tenant_id = ?').all(tenantId);
  const dishById = new Map(dishes.map((item) => [item.id, item]));
  const analysisById = new Map(analyses.map((item) => [item.id, item]));
  const feedbackAnalysisIds = new Set(feedback.map((item) => item.analysis_id));
  const candidateCounts = analyses.map((item) => parseJson(item.candidates_json, []).length);
  const confusion = new Map();
  for (const item of feedback.filter((entry) => entry.feedback_type === 'corrected' && entry.confirmed_dish_id)) {
    const candidates = parseJson(analysisById.get(item.analysis_id)?.candidates_json, []);
    const predicted = candidates[0];
    if (!predicted?.dishId || predicted.dishId === item.confirmed_dish_id) continue;
    const confirmed = dishById.get(item.confirmed_dish_id);
    const predictedStall = Array.isArray(predicted.stallPath) ? predicted.stallPath.at(-1) : null;
    const key = `${predicted.dishId}\u0000${item.confirmed_dish_id}`;
    const current = confusion.get(key) || {
      predictedDishId: predicted.dishId,
      predictedDishName: predicted.name || dishById.get(predicted.dishId)?.name || '',
      predictedStallId: predictedStall?.id || dishById.get(predicted.dishId)?.stall_id || null,
      confirmedDishId: item.confirmed_dish_id,
      confirmedDishName: confirmed?.name || '',
      confirmedStallId: confirmed?.stall_id || null,
      count: 0,
    };
    current.count += 1;
    confusion.set(key, current);
  }
  const resolvedFeedback = feedback.filter((item) => item.feedback_type !== 'unresolved');
  const correctedCount = feedback.filter((item) => item.feedback_type === 'corrected').length;
  const p95Ms = percentile(analyses.map((item) => item.latency_ms), 0.95);
  const totalCost = usage.reduce((sum, item) => sum + Number(item.estimated_cost || 0), 0);
  return {
    window: { days: boundedDays, from: fromIso, to: to.toISOString() },
    analysisCount: analyses.length,
    candidateCoverageRate: roundedMetric(analyses.length ? candidateCounts.filter((count) => count > 0).length / analyses.length : 0),
    averageCandidateCount: roundedMetric(analyses.length ? candidateCounts.reduce((sum, count) => sum + count, 0) / analyses.length : 0, 2),
    feedbackCount: feedback.length,
    userCorrectionRate: roundedMetric(resolvedFeedback.length ? correctedCount / resolvedFeedback.length : 0),
    unresolvedFeedbackCount: feedback.filter((item) => item.feedback_type === 'unresolved').length,
    autoMatchedCount: analyses.filter((item) => item.match_status === 'auto_matched' && !feedbackAnalysisIds.has(item.id)).length,
    latency: { p95Ms, targetMs: 8000, meetsTarget: p95Ms <= 8000 },
    cost: {
      calls: usage.length,
      successfulCalls: usage.filter((item) => item.status === 'success').length,
      imageCount: usage.reduce((sum, item) => sum + Number(item.image_count || 0), 0),
      estimatedTotal: roundedMetric(totalCost, 6),
    },
    confusionMatrix: [...confusion.values()].sort((left, right) => right.count - left.count),
  };
}

export async function listDishReferenceImages(db, tenantId, dishId) {
  return (await db.prepare(`SELECT r.*, u.public_url, e.status AS embedding_status, e.model AS embedding_model
    FROM dish_reference_images r
    JOIN uploads u ON u.id = r.upload_id AND u.tenant_id = r.tenant_id
    LEFT JOIN dish_image_embeddings e ON e.reference_image_id = r.id AND e.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.dish_id = ? ORDER BY r.created_at DESC`).all(tenantId, dishId)).map(publicReference);
}

export async function addDishReferenceImage({ db, user, dishId, body = {} }) {
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const dish = await db.prepare('SELECT id FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantId, dishId);
  if (!dish) throw Object.assign(new Error('菜品不存在'), { status: 404, code: 'DISH_NOT_FOUND' });
  const uploadId = String(body.uploadId || '').trim();
  const upload = await db.prepare('SELECT * FROM uploads WHERE tenant_id = ? AND id = ?').get(tenantId, uploadId);
  if (!upload || !String(upload.content_type || '').startsWith('image/')) {
    throw Object.assign(new Error('请选择当前校园内已上传的图片'), { status: 400, code: 'REFERENCE_UPLOAD_NOT_FOUND' });
  }
  const purpose = body.purpose === 'evaluation' ? 'evaluation' : 'reference';
  const qualityStatus = body.qualityStatus === 'approved' ? 'approved' : body.qualityStatus === 'rejected' ? 'rejected' : 'pending';
  const id = `dish-ref-${randomUUID()}`;
  const now = isoNow();
  await db.prepare(`INSERT INTO dish_reference_images (
      id, tenant_id, dish_id, upload_id, purpose, angle, batch_key, quality_status,
      created_by, reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, tenantId, dishId, uploadId, purpose, String(body.angle || '').slice(0, 40),
      String(body.batchKey || '').slice(0, 80), qualityStatus, user.id,
      qualityStatus === 'pending' ? null : user.id, qualityStatus === 'pending' ? null : now, now, now,
    );
  if (purpose === 'reference' && qualityStatus === 'approved') {
    await db.prepare(`INSERT INTO dish_image_embeddings (
        reference_image_id, tenant_id, dish_id, model, dimension, embedding_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, tenantId, dishId, getVisionEmbeddingStatus().model, 768, null, 'pending', now, now,
      );
  }
  return (await listDishReferenceImages(db, tenantId, dishId)).find((item) => item.id === id);
}

export async function updateDishReferenceImage({ db, user, referenceImageId, body = {} }) {
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const row = await db.prepare('SELECT * FROM dish_reference_images WHERE tenant_id = ? AND id = ?').get(tenantId, referenceImageId);
  if (!row) throw Object.assign(new Error('参考图不存在'), { status: 404, code: 'REFERENCE_IMAGE_NOT_FOUND' });
  const qualityStatus = ['pending', 'approved', 'rejected'].includes(body.qualityStatus) ? body.qualityStatus : row.quality_status;
  const purpose = ['reference', 'evaluation'].includes(body.purpose) ? body.purpose : row.purpose;
  const now = isoNow();
  await db.prepare(`UPDATE dish_reference_images SET purpose = ?, angle = ?, batch_key = ?, quality_status = ?,
      reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
      purpose, String(body.angle ?? row.angle).slice(0, 40), String(body.batchKey ?? row.batch_key).slice(0, 80),
      qualityStatus, qualityStatus === 'pending' ? null : user.id, qualityStatus === 'pending' ? null : now,
      now, tenantId, referenceImageId,
    );
  if (purpose === 'reference' && qualityStatus === 'approved') {
    await db.prepare(`INSERT INTO dish_image_embeddings (
        reference_image_id, tenant_id, dish_id, model, dimension, embedding_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reference_image_id) DO UPDATE SET status='pending', error=NULL, updated_at=excluded.updated_at`).run(
        referenceImageId, tenantId, row.dish_id, getVisionEmbeddingStatus().model, 768, null, 'pending', now, now,
      );
  } else {
    await db.prepare('DELETE FROM dish_image_embeddings WHERE tenant_id = ? AND reference_image_id = ?').run(tenantId, referenceImageId);
  }
  return (await listDishReferenceImages(db, tenantId, row.dish_id)).find((item) => item.id === referenceImageId);
}

async function saveReferenceEmbedding(db, row, result) {
  const now = isoNow();
  if (db.isPostgres) {
    await db.query(`INSERT INTO dish_image_embeddings (
        reference_image_id, tenant_id, dish_id, model, dimension, embedding, embedding_json, status, error, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::vector,$7,'ready',NULL,$8,$8)
      ON CONFLICT(reference_image_id) DO UPDATE SET model=EXCLUDED.model, dimension=EXCLUDED.dimension,
        embedding=EXCLUDED.embedding, embedding_json=EXCLUDED.embedding_json, status='ready', error=NULL, updated_at=EXCLUDED.updated_at`,
      [row.id, row.tenant_id, row.dish_id, result.model, result.dimension, pgVectorLiteral(result.embedding), serializeJson(result.embedding), now]);
    return;
  }
  await db.prepare(`INSERT INTO dish_image_embeddings (
      reference_image_id, tenant_id, dish_id, model, dimension, embedding_json, status, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ready', NULL, ?, ?)
    ON CONFLICT(reference_image_id) DO UPDATE SET model=excluded.model, dimension=excluded.dimension,
      embedding_json=excluded.embedding_json, status='ready', error=NULL, updated_at=excluded.updated_at`).run(
      row.id, row.tenant_id, row.dish_id, result.model, result.dimension, serializeJson(result.embedding), now, now,
    );
}

export async function reindexDishReferenceImages({ db, user, dishId = null, limit = 100 }) {
  const status = getVisionEmbeddingStatus();
  if (!status.enabled) throw Object.assign(new Error('请先配置 VISION_EMBEDDING_BASE_URL'), { status: 400, code: 'VISION_EMBEDDING_NOT_CONFIGURED' });
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const rows = (await db.prepare(`SELECT r.*, u.content_type, u.storage_key, u.storage_provider
    FROM dish_reference_images r JOIN uploads u ON u.id = r.upload_id AND u.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.purpose = 'reference' AND r.quality_status = 'approved'
    ORDER BY r.updated_at`).all(tenantId)).filter((row) => !dishId || row.dish_id === dishId).slice(0, Math.min(500, Math.max(1, Number(limit) || 100)));
  let indexed = 0;
  const failures = [];
  for (const row of rows) {
    try {
      const stored = await readStoredUpload(row);
      const result = await createVisionImageEmbedding({ contentType: stored.contentType, dataBase64: stored.body.toString('base64') });
      await saveReferenceEmbedding(db, row, result);
      indexed += 1;
    } catch (error) {
      failures.push({ referenceImageId: row.id, error: error.message });
      const now = isoNow();
      await db.prepare(`INSERT INTO dish_image_embeddings (
          reference_image_id, tenant_id, dish_id, model, dimension, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, ?)
        ON CONFLICT(reference_image_id) DO UPDATE SET status='failed', error=excluded.error, updated_at=excluded.updated_at`).run(
          row.id, tenantId, row.dish_id, status.model, status.dimension, error.message.slice(0, 500), now, now,
        );
    }
  }
  return { requested: rows.length, indexed, failed: failures.length, failures, provider: status };
}

export async function createDishRecipeVersion({ db, user, dishId, body = {} }) {
  const tenantId = user.tenant_id || user.tenantId || 'default';
  const dish = await db.prepare('SELECT * FROM dishes WHERE tenant_id = ? AND id = ?').get(tenantId, dishId);
  if (!dish) throw Object.assign(new Error('菜品不存在'), { status: 404, code: 'DISH_NOT_FOUND' });
  const calculation = calculateRecipeNutrition(body);
  const approved = body.approve === true;
  const now = isoNow();
  const recipeId = `recipe-${randomUUID()}`;
  const nutritionId = `nutrition-${randomUUID()}`;
  const version = String(body.version || `recipe-${Date.now()}`).slice(0, 80);
  if (approved) {
    await db.prepare("UPDATE dish_recipe_versions SET status = 'archived', updated_at = ? WHERE tenant_id = ? AND dish_id = ? AND status = 'approved'").run(now, tenantId, dishId);
  }
  await db.prepare(`INSERT INTO dish_recipe_versions (
      id, tenant_id, dish_id, version, basis, serving_weight_grams, yield_weight_grams, status,
      notes, source_ids_json, created_by, reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      recipeId, tenantId, dishId, version, calculation.basis, calculation.portionGrams,
      calculation.yieldWeightGrams, approved ? 'approved' : 'draft', String(body.notes || '').slice(0, 1000),
      serializeJson(calculation.sourceIds), user.id, approved ? user.id : null, approved ? now : null, now, now,
    );
  for (const ingredient of calculation.ingredients) {
    await db.prepare(`INSERT INTO dish_recipe_ingredients (
        id, tenant_id, recipe_version_id, food_reference_id, ingredient_name,
        raw_weight_grams, edible_ratio, retention_factor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        `recipe-ingredient-${randomUUID()}`, tenantId, recipeId, ingredient.foodReferenceId,
        ingredient.ingredientName, ingredient.rawWeightGrams, ingredient.edibleRatio, ingredient.retentionFactor, now,
      );
  }
  await db.prepare(`INSERT INTO dish_nutrition_versions (
      id, tenant_id, dish_id, recipe_version_id, version, basis, portion_grams, status,
      source_type, nutrient_ranges_json, source_ids_json, reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recipe', ?, ?, ?, ?, ?, ?)`).run(
      nutritionId, tenantId, dishId, recipeId, version, calculation.basis, calculation.portionGrams,
      approved ? 'estimated' : 'unknown', serializeJson(calculation.ranges), serializeJson(calculation.sourceIds),
      approved ? user.id : null, approved ? now : null, now, now,
    );
  if (approved) {
    const p = calculation.points;
    await db.prepare(`UPDATE dishes SET calories = ?, protein = ?, fat = ?, carbs = ?, fiber = ?, sodium = ?,
        nutrition_fact_status = 'estimated', recipe_fact_status = 'verified', fact_source = 'recipe_calculation',
        fact_verified_at = ?, data_version = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
        p.calories, p.protein, p.fat, p.carbs, p.fiber, p.sodium, now, version, now, tenantId, dishId,
      );
  }
  return { recipeId, nutritionId, version, status: approved ? 'approved' : 'draft', calculation };
}

export async function listDishRecipeVersions(db, tenantId, dishId) {
  const recipes = await db.prepare('SELECT * FROM dish_recipe_versions WHERE tenant_id = ? AND dish_id = ? ORDER BY created_at DESC').all(tenantId, dishId);
  const result = [];
  for (const recipe of recipes) {
    const ingredients = await db.prepare('SELECT * FROM dish_recipe_ingredients WHERE tenant_id = ? AND recipe_version_id = ? ORDER BY created_at').all(tenantId, recipe.id);
    const nutrition = await db.prepare('SELECT * FROM dish_nutrition_versions WHERE tenant_id = ? AND recipe_version_id = ? ORDER BY created_at DESC LIMIT 1').get(tenantId, recipe.id);
    result.push({
      id: recipe.id,
      version: recipe.version,
      basis: recipe.basis,
      servingWeightGrams: recipe.serving_weight_grams,
      yieldWeightGrams: recipe.yield_weight_grams,
      status: recipe.status,
      notes: recipe.notes,
      sourceIds: parseJson(recipe.source_ids_json, []),
      ingredients: ingredients.map((item) => ({
        id: item.id,
        foodReferenceId: item.food_reference_id,
        ingredientName: item.ingredient_name,
        rawWeightGrams: item.raw_weight_grams,
        edibleRatio: item.edible_ratio,
        retentionFactor: item.retention_factor,
      })),
      nutrition: nutrition ? {
        status: nutrition.status,
        ranges: parseJson(nutrition.nutrient_ranges_json, {}),
        sourceIds: parseJson(nutrition.source_ids_json, []),
      } : unknownNutrition(),
      createdAt: recipe.created_at,
      updatedAt: recipe.updated_at,
    });
  }
  return result;
}
