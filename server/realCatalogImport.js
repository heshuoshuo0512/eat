import { createHash } from 'node:crypto';

const BATCH_STATUSES = new Set(['validated', 'approved']);

function json(value) {
  return JSON.stringify(value ?? null);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function parseJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function auditRowFingerprint(rows) {
  const normalized = rows.map((row) => canonicalize({
    id: row.id,
    sourceHash: row.sourceHash ?? row.source_hash,
    sourceName: row.sourceName ?? row.source_name,
    sourceLocator: row.sourceLocator ?? row.source_locator,
    entityType: row.entityType ?? row.entity_type,
    entityId: row.entityId ?? row.entity_id ?? null,
    status: row.status,
    rawText: row.rawText ?? row.raw_text ?? '',
    normalized: parseJson(row.normalized ?? row.normalized_json, {}),
    issues: parseJson(row.issues ?? row.issues_json, []),
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function isExactBatchReplay(db, batchId, tenantId, importRows) {
  const existing = db.prepare('SELECT tenant_id FROM data_import_batches WHERE id = ?').get(batchId);
  if (!existing || existing.tenant_id !== tenantId) return false;
  const storedRows = db.prepare(`SELECT id, source_hash, source_name, source_locator, entity_type, entity_id,
    status, raw_text, normalized_json, issues_json FROM catalog_import_rows WHERE batch_id = ? ORDER BY id`).all(batchId);
  return storedRows.length === importRows.length
    && auditRowFingerprint(storedRows) === auditRowFingerprint(importRows);
}

function uniqueIds(rows, label) {
  const ids = rows.map((row) => String(row?.id || '').trim());
  if (ids.some((id) => !id)) throw new Error(`${label} contains an empty id`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids`);
  return new Set(ids);
}

function placeholders(length) {
  return Array.from({ length }, () => '?').join(',');
}

function assertNoConflicts(db, table, ids) {
  if (!ids.size) return;
  const values = [...ids];
  const found = db.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders(values.length)})`).all(...values);
  if (found.length) {
    throw Object.assign(new Error(`${table} contains ids owned by another batch: ${found.slice(0, 5).map((row) => row.id).join(', ')}`), {
      code: 'CATALOG_ENTITY_CONFLICT',
    });
  }
}

function validateBundle(bundle, tenantId) {
  if (!bundle || typeof bundle !== 'object') throw new Error('Catalog bundle must be an object');
  if (String(bundle.manifest?.tenantId || '') !== tenantId) throw new Error('Catalog tenant does not match the target tenant');
  if (!String(bundle.manifest?.batchId || '').trim()) throw new Error('Catalog batch id is required');
  if (!Array.isArray(bundle.canteens) || !Array.isArray(bundle.stalls) || !Array.isArray(bundle.dishes)) {
    throw new Error('Catalog canteens, stalls and dishes must be arrays');
  }
  if (Array.isArray(bundle.menus) && bundle.menus.length) throw new Error('Real catalog staging must not include menus');
  const canteenIds = uniqueIds(bundle.canteens, 'canteens');
  const stallIds = uniqueIds(bundle.stalls, 'stalls');
  uniqueIds(bundle.dishes, 'dishes');
  for (const canteen of bundle.canteens) {
    if (canteen.parentId && !canteenIds.has(canteen.parentId)) throw new Error(`Unknown parent canteen ${canteen.parentId}`);
  }
  for (const stall of bundle.stalls) {
    if (!canteenIds.has(stall.canteenId)) throw new Error(`Unknown canteen ${stall.canteenId} for stall ${stall.id}`);
  }
  for (const dish of bundle.dishes) {
    if (!stallIds.has(dish.stallId)) throw new Error(`Unknown stall ${dish.stallId} for dish ${dish.id}`);
    if (dish.synthetic !== false) throw new Error(`Real catalog dish ${dish.id} must have synthetic=false`);
    if (!dish.sourceRef?.batchId || !dish.sourceRef?.sources?.length) throw new Error(`Dish ${dish.id} is missing source references`);
    if (dish.factStatus?.nutrition !== 'unknown' || dish.factStatus?.recipe !== 'unknown') {
      throw new Error(`Dish ${dish.id} contains unverified nutrition or recipe facts`);
    }
    const unknownDeclaration = dish.safetyDeclarations?.some((item) => item.allergenCode === '*' && item.status === 'unknown');
    if (!unknownDeclaration) throw new Error(`Dish ${dish.id} is missing the wildcard unknown allergen declaration`);
  }
  return {
    batchId: String(bundle.manifest.batchId),
    canteenIds,
    stallIds,
    dishIds: new Set(bundle.dishes.map((dish) => dish.id)),
  };
}

function insertAuditRow(db, row, tenantId, batchId, now) {
  db.prepare(`INSERT INTO catalog_import_rows
      (id, tenant_id, batch_id, source_hash, source_name, source_locator, entity_type, entity_id,
       status, raw_text, normalized_json, issues_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      tenantId,
      batchId,
      row.sourceHash,
      row.sourceName,
      row.sourceLocator,
      row.entityType,
      row.entityId || null,
      row.status,
      row.rawText || '',
      json(row.normalized || {}),
      json(row.issues || []),
      now,
    );
}

function missingEntityAuditRows(bundle) {
  const sourcesByArea = new Map((bundle.manifest.sources || []).map((source) => [source.areaId, source]));
  const aggregateHash = createHash('sha256')
    .update((bundle.manifest.sources || []).map((source) => source.sha256).sort().join(':'))
    .digest('hex');
  const existing = new Set((bundle.importRows || [])
    .filter((row) => row.status === 'accepted' && row.entityId)
    .map((row) => `${row.entityType}:${row.entityId}`));
  const entities = [
    ...bundle.canteens.map((entity) => ({ entityType: 'canteen', entity })),
    ...bundle.stalls.map((entity) => ({ entityType: 'stall', entity })),
    ...bundle.dishes.map((entity) => ({ entityType: 'dish', entity })),
  ];
  return entities.filter(({ entityType, entity }) => !existing.has(`${entityType}:${entity.id}`)).map(({ entityType, entity }) => {
    const sourceRef = entity.sourceRef?.sources?.[0] || {};
    const source = sourcesByArea.get(entity.id) || sourcesByArea.get(entity.canteenId) || sourcesByArea.get(entity.sourceRef?.areaId);
    const sourceHash = sourceRef.sourceHash || source?.sha256 || aggregateHash;
    const sourceName = sourceRef.sourceName || source?.name || 'catalog-manifest';
    const sourceLocator = sourceRef.locator || `catalog:${entityType}:${entity.id}`;
    return {
      id: `import-row-${createHash('sha256').update(`${bundle.manifest.batchId}:${entityType}:${entity.id}`).digest('hex').slice(0, 14)}`,
      sourceHash,
      sourceName,
      sourceLocator,
      entityType,
      entityId: entity.id,
      status: 'accepted',
      rawText: entity.name,
      normalized: entity,
      issues: [],
    };
  });
}

function deleteIds(db, table, ids) {
  if (!ids.length) return 0;
  return Number(db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders(ids.length)})`).run(...ids).changes || 0);
}

function rollbackWithinTransaction(db, batchId) {
  const rows = db.prepare(`SELECT tenant_id, entity_type, entity_id, normalized_json FROM catalog_import_rows
    WHERE batch_id = ? AND status = 'accepted' AND entity_id IS NOT NULL`).all(batchId);
  const ids = (type) => [...new Set(rows.filter((row) => row.entity_type === type).map((row) => row.entity_id))];
  const tenantId = rows[0]?.tenant_id || db.prepare('SELECT tenant_id FROM data_import_batches WHERE id = ?').get(batchId)?.tenant_id || 'default';
  const deleteRetrievalSources = (sourceType, sourceIds) => {
    if (!sourceIds.length) return 0;
    return Number(db.prepare(`DELETE FROM rag_documents
      WHERE tenant_id = ? AND source_type = ? AND source_id IN (${placeholders(sourceIds.length)})`)
      .run(tenantId, sourceType, ...sourceIds).changes || 0);
  };
  const dishIds = ids('dish');
  const stallIds = ids('stall');
  const deleted = {
    retrievalDocuments: deleteRetrievalSources('dish', dishIds) + deleteRetrievalSources('stall', stallIds),
    dishes: deleteIds(db, 'dishes', dishIds),
    stalls: deleteIds(db, 'stalls', stallIds),
    canteens: 0,
  };
  const pendingCanteens = new Set(ids('canteen'));
  const parentById = new Map(rows.filter((row) => row.entity_type === 'canteen').map((row) => {
    let normalized = {};
    try { normalized = JSON.parse(row.normalized_json || '{}'); } catch {}
    return [row.entity_id, normalized.parentId || normalized.parent_id || null];
  }));
  while (pendingCanteens.size) {
    const parentIds = new Set([...pendingCanteens].map((id) => parentById.get(id)).filter((id) => pendingCanteens.has(id)));
    const leaves = [...pendingCanteens].filter((id) => !parentIds.has(id));
    const targets = leaves.length ? leaves : [...pendingCanteens];
    deleted.canteens += deleteIds(db, 'canteens', targets);
    for (const id of targets) pendingCanteens.delete(id);
  }
  db.prepare('DELETE FROM data_import_batches WHERE id = ?').run(batchId);
  return deleted;
}

export function rollbackRealCatalogBatch(db, batchId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const deleted = rollbackWithinTransaction(db, String(batchId));
    db.exec('COMMIT');
    return deleted;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function importRealCatalog(db, bundle, options = {}) {
  const tenantId = String(options.tenantId || 'default');
  const finalStatus = String(options.status || 'validated');
  if (!BATCH_STATUSES.has(finalStatus)) throw new Error(`Unsupported import status ${finalStatus}`);
  const validated = validateBundle(bundle, tenantId);
  const batchId = validated.batchId;
  const now = options.now || new Date().toISOString();
  const importRows = [...(bundle.importRows || []), ...missingEntityAuditRows(bundle)];
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT id, status FROM data_import_batches WHERE id = ?').get(batchId);
    if (existing && isExactBatchReplay(db, batchId, tenantId, importRows)) {
      const status = existing.status === 'approved' ? 'approved' : finalStatus;
      db.prepare(`UPDATE data_import_batches SET status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`)
        .run(status, status === 'approved' ? (options.reviewedBy || 'local-validation') : null, now, batchId);
      db.exec('COMMIT');
      return {
        batchId,
        status,
        canteens: bundle.canteens.length,
        stalls: bundle.stalls.length,
        dishes: bundle.dishes.length,
        importRows: importRows.length,
        reviewRequired: Number(bundle.report?.reviewRequiredCount || 0),
        idempotent: true,
      };
    }
    if (existing) rollbackWithinTransaction(db, batchId);
    assertNoConflicts(db, 'canteens', validated.canteenIds);
    assertNoConflicts(db, 'stalls', validated.stallIds);
    assertNoConflicts(db, 'dishes', validated.dishIds);

    db.prepare(`INSERT INTO data_import_batches
      (id, tenant_id, entity_type, status, source_name, row_count, error_count, created_by, reviewed_by, created_at, updated_at)
      VALUES (?, ?, 'real_catalog', 'draft', ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        batchId,
        tenantId,
        (bundle.manifest.sources || []).map((source) => source.name).join(', '),
        importRows.length,
        Number(bundle.report?.reviewRequiredCount || 0),
        options.createdBy || 'real-catalog-import',
        finalStatus === 'approved' ? (options.reviewedBy || 'local-validation') : null,
        now,
        now,
      );

    const insertCanteen = db.prepare(`INSERT INTO canteens
      (id, tenant_id, name, display_name, display_order, operating_status, location, hours, crowd_level, tags_json, description, parent_id, canteen_type, image, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const canteen of bundle.canteens) {
      insertCanteen.run(
        canteen.id, tenantId, canteen.name, canteen.displayName || canteen.name, Number(canteen.displayOrder ?? 999), canteen.operatingStatus || 'open', canteen.location || '', canteen.hours || '待核验',
        Number(canteen.crowdLevel || 0), json(canteen.tags || []), canteen.description || '',
        canteen.parentId || null, canteen.canteenType || (canteen.parentId ? 'sub' : 'primary'),
        canteen.imageUrl || '', now, now,
      );
    }

    const insertStall = db.prepare(`INSERT INTO stalls
      (id, tenant_id, canteen_id, parent_id, floor, name, aliases_json, category, rating, avg_price, open, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const stall of bundle.stalls) {
      insertStall.run(
        stall.id, tenantId, stall.canteenId, stall.parentId || null, stall.floor || '待核验', stall.name, json(stall.aliases || []),
        stall.category || '待核验', Number(stall.rating || 0), Number(stall.avgPrice || 0), stall.open ? 1 : 0,
        stall.description || '', now, now,
      );
    }

    const insertDish = db.prepare(`INSERT INTO dishes
      (id, tenant_id, stall_id, name, price, pricing_mode, price_display, pricing_json, taste, cuisine,
       ingredients_json, seasonings_json, additives_json, tags_json, aliases_json, semantic_labels_json,
       halal, meal_types_json, calories, protein, fat, carbs, fiber, sodium, sugar, calcium, iron,
       rating, review_count, sales, image, image_url, description, status, allergens_json,
       safety_declarations_json, dietary_labels_json, nutrition_fact_status, recipe_fact_status,
       halal_fact_status, dietary_fact_status, spice_level, spice_fact_status, fact_source,
       fact_verified_at, fact_expires_at, data_version, synthetic, source_ref_json, created_at, updated_at)
      VALUES (${placeholders(51)})`);
    for (const dish of bundle.dishes) {
      insertDish.run(
        dish.id, tenantId, dish.stallId, dish.name, Number(dish.price), dish.pricingMode, dish.priceDisplay,
        json(dish.pricing), dish.taste || '待核验', dish.cuisine || '待核验', json(dish.ingredients || []),
        json(dish.seasonings || []), json(dish.additives || []), json(dish.tags || []), json(dish.aliases || []),
        json(dish.semanticLabels || []), dish.halal ? 1 : 0, json(dish.mealTypes || []),
        Number(dish.nutrition?.calories || 0), Number(dish.nutrition?.protein || 0), Number(dish.nutrition?.fat || 0),
        Number(dish.nutrition?.carbs || 0), Number(dish.fiber || 0), Number(dish.sodium || 0), Number(dish.sugar || 0),
        Number(dish.calcium || 0), Number(dish.iron || 0), Number(dish.rating || 0), Number(dish.reviewCount || 0),
        Number(dish.sales || 0), dish.image || '', dish.imageUrl || '', dish.description || '', dish.status || 'active',
        json(dish.allergens || []), json(dish.safetyDeclarations || []), json(dish.dietaryLabels || []),
        dish.factStatus?.nutrition || 'unknown', dish.factStatus?.recipe || 'unknown', dish.factStatus?.halal || 'unknown',
        dish.factStatus?.dietary || 'unknown', dish.spiceLevel ?? null, dish.factStatus?.spice || 'unknown',
        dish.factSource || 'menu_document', dish.factVerifiedAt || null, dish.factExpiresAt || null,
        dish.dataVersion || bundle.manifest.dataVersion, 0, json(dish.sourceRef || {}), now, now,
      );
    }

    for (const row of importRows) insertAuditRow(db, row, tenantId, batchId, now);
    db.prepare('UPDATE data_import_batches SET status = ?, updated_at = ? WHERE id = ?').run(finalStatus, now, batchId);
    db.exec('COMMIT');
    return {
      batchId,
      status: finalStatus,
      canteens: bundle.canteens.length,
      stalls: bundle.stalls.length,
      dishes: bundle.dishes.length,
      importRows: importRows.length,
      reviewRequired: Number(bundle.report?.reviewRequiredCount || 0),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
