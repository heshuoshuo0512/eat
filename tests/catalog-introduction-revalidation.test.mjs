import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogIntroductionEvidence, validateCatalogIntroductionBatch } from '../server/catalogIntroductions.js';
import { openDatabase } from '../server/database.js';
import { revalidateRecords } from '../scripts/revalidate-catalog-introductions-postgres.mjs';

describe('catalog introduction revalidation', () => {
  it('revalidates a stable-ID introduction against current evidence', async () => {
    const db = openDatabase(':memory:');
    try {
      const catalog = await loadCatalogIntroductionEvidence(db);
      const evidence = catalog.evidence.find((item) => item.hierarchyLevel === 'dish');
      const ownId = `dish:${evidence.entity.id}`;
      const relatedId = evidence.stall?.id
        ? `stall:${evidence.stall.id}`
        : evidence.allowedEvidenceIds.find((id) => id.startsWith('canteen:'));
      const [candidate] = validateCatalogIntroductionBatch({ introductions: [{
        entityType: 'dish',
        entityId: evidence.entity.id,
        factualClaims: [
          { text: `${evidence.entity.name}目录价格为${evidence.entity.priceDisplay}。`, evidenceIds: [ownId] },
          { text: `归属${evidence.stall.name}档口。`, evidenceIds: [relatedId] },
        ],
        recommendationClaims: [{ text: '可结合目录位置进一步了解，具体配方待核验。', evidenceIds: [relatedId] }],
        semanticLabels: [],
        boundaryCodes: evidence.boundaryCodes,
      }] }, [evidence]);
      const sourceRecord = { id: 'source-record', ...candidate };
      const result = revalidateRecords([sourceRecord], [evidence]);
      assert.equal(result.valid.length, 1);
      assert.equal(result.missing.length, 0);
      assert.equal(result.failed.length, 0);
      assert.equal(result.quality.ok, true);
      assert.equal(result.valid[0].candidate.inputHash, evidence.inputHash);
    } finally {
      db.close();
    }
  });

  it('keeps missing and invalid stable IDs out of the publish set', async () => {
    const db = openDatabase(':memory:');
    try {
      const catalog = await loadCatalogIntroductionEvidence(db);
      const evidence = catalog.evidence.find((item) => item.hierarchyLevel === 'dish');
      const ownId = `dish:${evidence.entity.id}`;
      const relatedId = `stall:${evidence.stall.id}`;
      const [candidate] = validateCatalogIntroductionBatch({ introductions: [{
        entityType: 'dish',
        entityId: evidence.entity.id,
        factualClaims: [
          { text: `${evidence.entity.name}目录价格为${evidence.entity.priceDisplay}。`, evidenceIds: [ownId] },
          { text: `归属${evidence.stall.name}档口。`, evidenceIds: [relatedId] },
        ],
        recommendationClaims: [{ text: '可结合目录位置进一步了解，具体配方待核验。', evidenceIds: [relatedId] }],
        semanticLabels: [],
        boundaryCodes: evidence.boundaryCodes,
      }] }, [evidence]);
      const sourceRecord = { id: 'source-record', ...candidate };
      const missing = revalidateRecords([sourceRecord], []);
      assert.equal(missing.valid.length, 0);
      assert.equal(missing.missing.length, 1);
      const invalid = revalidateRecords([sourceRecord], [{
        ...evidence,
        allowedEvidenceIds: evidence.allowedEvidenceIds.filter((id) => id !== relatedId),
      }]);
      assert.equal(invalid.valid.length, 0);
      assert.equal(invalid.failed.length, 1);
      assert.equal(invalid.failed[0].code, 'INVALID_CATALOG_INTRODUCTION_REFERENCE');
    } finally {
      db.close();
    }
  });
});
