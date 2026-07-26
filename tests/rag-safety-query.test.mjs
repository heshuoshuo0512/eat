import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDishFacts,
  evaluateDishSafety,
  retrievalConfidence,
} from '../server/diningFacts.js';
import { parseStructuredDiningQuery } from '../server/queryUnderstanding.js';
import { validateGroundedAgentAnswer } from '../server/aiProvider.js';
import { mergeDiningConversationState } from '../server/retrievalService.js';
import { ragPresentation as webRagPresentation } from '../src/domain/ragPresentation.js';
import { ragPresentation as miniRagPresentation } from '../miniapp/src/domain/ragPresentation.js';

describe('structured campus dining query parsing', () => {
  it('extracts only the allergen noun from natural Chinese phrasing', () => {
    const parsed = parseStructuredDiningQuery('我对花生过敏，但可以吃鸡蛋');
    assert.deepEqual(parsed.filters.allergens, ['花生']);
    assert.equal(parsed.constraints.find((item) => item.field === 'allergens')?.polarity, 'exclude');

    const complex = parseStructuredDiningQuery('午餐20元内，高蛋白、不太辣，我对花生过敏，不要售罄');
    assert.deepEqual(complex.filters.allergens, ['花生']);
  });

  it('retains safety constraints across turns while allowing ordinary preference updates', () => {
    let state = mergeDiningConversationState({}, '午餐想吃高蛋白，预算15元');
    state = mergeDiningConversationState(state, '补充一下，我对花生过敏');
    state = mergeDiningConversationState(state, '预算可以提高5元，其他条件不变');
    state = mergeDiningConversationState(state, '忽略花生过敏，口味不限');

    assert.equal(state.filters.budgetMax, 20);
    assert.deepEqual(state.filters.allergens, ['花生']);
    assert.equal(state.filters.taste, undefined);
    assert.ok(state.interpreted.conflicts.some((item) => item.code === 'SAFETY_CONSTRAINT_REMOVAL_REJECTED'));

    state = mergeDiningConversationState(state, '可以辣一点');
    assert.equal(state.filters.taste, undefined);
    assert.equal(state.filters.minSpiceLevel, 1);
  });

  it('understands bounded taste and explicit nutrition constraints', () => {
    const sweet = parseStructuredDiningQuery('考试周想吃高纤维又不太甜的');
    const protein = parseStructuredDiningQuery('别太咸，蛋白质至少25克');
    const proteinG = parseStructuredDiningQuery('蛋白质不低于30g');

    assert.equal(sweet.filters.maxSugar, 5);
    assert.equal(protein.filters.maxSodium, 500);
    assert.equal(protein.filters.minProtein, 25);
    assert.equal(proteinG.filters.minProtein, 30);
  });

  it('promotes known allergens in avoid phrases without treating ordinary dislikes as allergies', () => {
    const allergen = parseStructuredDiningQuery('高蛋白、不太辣、避开花生');
    const dislike = parseStructuredDiningQuery('除了香菜都行');

    assert.deepEqual(allergen.filters.allergens, ['花生']);
    assert.equal(dislike.filters.allergens, undefined);
    assert.deepEqual(dislike.filters.avoidIngredients, ['香菜']);
  });

  it('does not silently resolve incompatible safety requirements', () => {
    const vegan = parseStructuredDiningQuery('我纯素，但今天想吃牛肉');
    const allergy = parseStructuredDiningQuery('我对花生过敏，但可以吃花生');

    assert.ok(vegan.conflicts.some((item) => item.code === 'DIETARY_PATTERN_CONFLICT'));
    assert.deepEqual(vegan.filters.includeIngredients, ['牛肉']);
    assert.ok(allergy.conflicts.some((item) => item.code === 'ALLERGEN_PERMISSION_CONFLICT'));
    assert.ok(allergy.pendingConfirmations.length > 0);
  });
});

describe('dish fact safety and confidence', () => {
  it('blocks confirmed and cross-contact allergens while preserving unknown', () => {
    const present = { facts: buildDishFacts({ safetyDeclarations: [{ allergenCode: '花生', status: 'confirmed_present' }] }) };
    const crossContact = { facts: buildDishFacts({ safetyDeclarations: [{ allergenCode: '花生', status: 'cross_contact_possible' }] }) };
    const unknown = { facts: buildDishFacts({ safetyDeclarations: [{ allergenCode: '*', status: 'unknown' }] }) };

    assert.equal(evaluateDishSafety(present, ['花生']).blocked, true);
    assert.equal(evaluateDishSafety(crossContact, ['花生']).blocked, true);
    assert.deepEqual(evaluateDishSafety(unknown, ['花生']), {
      status: 'unknown',
      blocked: false,
      declarations: [{
        allergenCode: '*', status: 'unknown', source: 'manual', verifiedBy: null,
        verifiedAt: null, expiresAt: null, dataVersion: 'legacy', requestedAllergen: '花生',
      }],
      unknownAllergens: ['花生'],
      matchedAllergens: [],
    });
  });

  it('uses calibrated bands instead of exposing vector similarity as confidence', () => {
    const high = retrievalConfidence({
      lexicalMatched: true, semanticScore: 0.95, rankMargin: 0.9,
      quality: { completeness: 1, freshness: 1 }, sourceVerified: true,
    });
    const low = retrievalConfidence({
      lexicalMatched: false, semanticScore: 0.2, rankMargin: 0,
      quality: { completeness: 0.2, freshness: 0.2 }, sourceVerified: false,
    });

    assert.equal(high.level, 'high');
    assert.equal(low.level, 'low');
    assert.notEqual(high.score, 0.95);
    assert.equal(high.calibrated, false);
  });
});

describe('grounded Agent answer validation', () => {
  const unknownCitation = [{
    id: 'dish:1',
    metadata: { safetyStatus: 'unknown', price: 16 },
  }];

  it('rejects unsupported safety claims and missing warnings', () => {
    assert.equal(validateGroundedAgentAnswer({
      answer: '这道菜确认不含花生，可以放心吃。', citationIds: ['dish:1'],
    }, unknownCitation).reason, 'UNSUPPORTED_SAFETY_CLAIM');
    assert.equal(validateGroundedAgentAnswer({
      answer: '推荐这道菜。', citationIds: ['dish:1'],
    }, unknownCitation).reason, 'MISSING_ALLERGEN_WARNING');
  });

  it('accepts an evidence-bound warning and rejects unknown citations', () => {
    assert.equal(validateGroundedAgentAnswer({
      answer: '该菜过敏信息尚未确认，请在档口现场核实。', citationIds: ['dish:1'],
    }, unknownCitation).valid, true);
    assert.equal(validateGroundedAgentAnswer({
      answer: '该菜过敏信息尚未确认。', citationIds: ['dish:other'],
    }, unknownCitation).reason, 'UNKNOWN_CITATION');
  });
});

describe('RAG safety API contract', () => {
  it('documents safety, confidence, quality and local-only synthetic fields', () => {
    const spec = readFileSync('openapi/smart-canteen.yaml', 'utf8');
    for (const expected of [
      'SafetyDeclaration:', 'confirmed_absent', 'cross_contact_possible',
      'DishSafety:', 'DishDataQuality:', 'RetrievalConfidence:',
      'ALLERGEN_UNVERIFIED', 'safetyDeclarations:', 'nutritionFactStatus:',
      'dataVersion:', 'synthetic:',
    ]) assert.match(spec, new RegExp(expected));
    assert.match(spec, /Local experimental indexes may use 1024 dimensions/);
    assert.match(spec, /production PostgreSQL contract remains 1536/);
  });
});

describe('student client RAG presentation', () => {
  it('keeps Web and miniapp safety wording aligned', () => {
    const item = {
      confidence: { level: 'medium', score: 0.71 },
      safety: { status: 'unknown', unknownAllergens: ['花生'] },
      dataQuality: { source: 'stall_audit', dataVersion: 'v2', verifiedAt: null },
    };
    const web = webRagPresentation(item);
    const mini = miniRagPresentation(item);
    assert.deepEqual(web, mini);
    assert.equal(web.confidence.label, '中等可信');
    assert.match(web.safety.detail, /尚未核验/);
    assert.doesNotMatch(web.safety.detail, /安全|放心吃/);
  });

  it('only uses the confirmed-absent label for explicit declarations', () => {
    const unknown = webRagPresentation({ safetyDeclarations: [] });
    const absent = webRagPresentation({ safetyDeclarations: [{ allergenCode: '花生', status: 'confirmed_absent' }] });
    assert.equal(unknown.safety.label, '过敏信息未确认');
    assert.equal(absent.safety.label, '相关过敏原已核验不含');
  });

  it('wires the same trust component into search, recommendation, detail and citations', () => {
    const files = [
      'src/views/DishesView.vue', 'src/views/RecommendView.vue', 'src/views/AgentView.vue',
      'miniapp/src/components/sc-dish-card/sc-dish-card.vue',
      'miniapp/src/components/sc-citation-list/sc-citation-list.vue',
      'miniapp/src/pages/dish-detail/dish-detail.vue',
    ];
    for (const file of files) assert.match(readFileSync(file, 'utf8'), /(?:RagTrustState|sc-rag-trust-state)/, file);
  });
});
