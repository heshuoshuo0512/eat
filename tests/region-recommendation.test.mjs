import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalogTasteGroups, classifyCatalogTaste } from '../server/catalogTasteGroups.js';

describe('regional taste recommendation contract', () => {
  it('exposes regional and flavor groups rather than meal categories', () => {
    const ids = catalogTasteGroups('meal').map((group) => group.id);
    assert.ok(ids.includes('cantonese'));
    assert.ok(ids.includes('sichuan-hunan'));
    assert.ok(ids.includes('northwest'));
    assert.ok(ids.includes('hotpot'));
    assert.equal(ids.includes('breakfast'), false);
    assert.equal(ids.includes('noodles'), false);
    assert.equal(ids.includes('rice'), false);
  });

  it('returns an auditable decision for every recognized dish cue', () => {
    const result = classifyCatalogTaste({ name: '\u8089\u5939\u998d' });
    assert.equal(result.id, 'northwest');
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.evidence, [{ field: 'name', value: '\u8089\u5939\u998d', cue: '\u8089\u5939\u998d', rule: 'dish_name_cue' }]);
  });

  it('does not treat generic taste or meal category as regional evidence', () => {
    const result = classifyCatalogTaste({ name: '\u897f\u7ea2\u67ff\u9e21\u86cb\u9762', taste: '\u5fae\u8fa3' });
    assert.equal(result.confidence, 'unresolved');
    assert.deepEqual(result.evidence, []);
  });
});
