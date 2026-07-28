import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildGroundedAnswerRequirements,
  groundingEvidenceClasses,
  validateGroundedAgentAnswer,
} from '../server/aiProvider.js';
import {
  buildGroundedAnswerEvaluationCases,
  GROUNDED_ANSWER_EVALUATION_COUNTS,
} from '../scripts/lib/grounded-answer-evaluation.mjs';

function fixtureDishes(count = 60) {
  const pricingModes = ['fixed', 'per_weight', 'per_person', 'variants', 'tiered', 'per_item'];
  return Array.from({ length: count }, (_, index) => ({
    id: `dish-${index + 1}`,
    name: `评测菜品${index + 1}`,
    pricingMode: pricingModes[index % pricingModes.length],
    stallId: `stall-${index % 20}`,
    stallName: `档口${index % 20}`,
    canteenId: `canteen-${index % 9}`,
    canteenName: `次级餐厅${index % 9}`,
    parentCanteenId: 'campus-main',
    parentCanteenName: '西区大食堂',
  }));
}

function fixtureReferences(count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    id: `reference-${index + 1}`,
    canonicalName: `参考食材${index + 1}`,
  }));
}

describe('grounded answer 3x30 evaluation plan', () => {
  it('builds three distinct 30-question rounds over tenant, knowledge, reference and adversarial evidence', () => {
    const cases = buildGroundedAnswerEvaluationCases({
      dishes: fixtureDishes(),
      references: fixtureReferences(),
    });
    assert.equal(cases.length, GROUNDED_ANSWER_EVALUATION_COUNTS.total);
    assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
    for (const round of GROUNDED_ANSWER_EVALUATION_COUNTS.rounds) {
      assert.equal(cases.filter((item) => item.round === round).length, GROUNDED_ANSWER_EVALUATION_COUNTS.perRound);
    }
    assert.equal(cases.filter((item) => item.category === 'catalog_fact').length, 30);
    assert.equal(cases.filter((item) => item.category === 'food_composition_boundary').length, 10);
    assert.equal(cases.filter((item) => item.category === 'unknown_allergen').length, 10);
    assert.equal(cases.filter((item) => item.category === 'tenant_policy').length, 10);
    assert.equal(cases.filter((item) => item.forceEmptyEvidence).length, 5);
    assert.equal(cases.filter((item) => item.category === 'prompt_injection').length, 5);
  });

  it('keeps the evaluator isolated from the runtime database and makes chat opt-in', () => {
    const script = readFileSync('scripts/evaluate-grounded-agent-answers.mjs', 'utf8');
    assert.match(script, /Runtime database cannot be used/);
    assert.match(script, /argument === '--run-chat'/);
    assert.match(script, /argument === '--resume'/);
    assert.match(script, /argument === '--retry-blocked-chat'/);
    assert.match(script, /argument === '--retry-rejected-chat'/);
    assert.match(script, /argument === '--no-chat-repair'/);
    assert.match(script, /argument\.startsWith\('--limit='\)/);
    assert.match(script, /item\.generation\?\.status === 'provider_failed'/);
    assert.match(script, /completed_with_safety_fallbacks/);
    assert.match(script, /chatProviderFailures/);
    assert.match(script, /chatNetworkFailures/);
    assert.match(script, /firstPassAcceptedRate/);
    assert.match(script, /repairAcceptedRate/);
    assert.match(script, /finalModelAcceptedRate/);
    assert.match(script, /includeRejectedOutput: true/);
    assert.match(script, /checkpointEvery/);
    assert.match(script, /CHAT_EVALUATION_NOT_REQUESTED/);
    assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]{20,}/);
  });
});

describe('grounded answer evidence boundaries', () => {
  it('classifies tenant facts, reviewed knowledge, references and AI estimates independently', () => {
    assert.deepEqual(groundingEvidenceClasses({ sourceType: 'dish', metadata: {} }), ['tenant_fact']);
    assert.deepEqual(groundingEvidenceClasses({ sourceType: 'health_knowledge', metadata: {} }), ['verified_knowledge']);
    assert.deepEqual(groundingEvidenceClasses({ sourceType: 'food_composition_reference', evidenceType: 'reference_only' }), ['reference_only']);
    assert.deepEqual(groundingEvidenceClasses({
      sourceType: 'dish',
      metadata: { semanticEvidenceTypes: ['tenant_dish_fact', 'ai_estimated'] },
    }), ['tenant_fact', 'ai_estimated']);
  });

  it('rejects unconfirmed supply, unlabeled estimates and reference values presented without boundaries', () => {
    const catalog = [{
      id: 'dish:catalog',
      sourceType: 'dish',
      metadata: { availabilityStatus: 'catalog_only', supplyConfirmed: false, nutritionFactStatus: 'unknown' },
    }];
    assert.equal(validateGroundedAgentAnswer({
      answer: '这道菜今日有售。', citationIds: ['dish:catalog'],
    }, catalog).reason, 'UNSUPPORTED_SUPPLY_CLAIM');
    assert.equal(validateGroundedAgentAnswer({
      answer: '这道菜有500千卡。', citationIds: ['dish:catalog'],
    }, catalog).reason, 'UNSUPPORTED_NUTRITION_CLAIM');

    const estimated = [{
      id: 'dish:estimated',
      sourceType: 'dish',
      metadata: {
        semanticEvidenceTypes: ['tenant_dish_fact', 'ai_estimated'],
        aiEstimated: { tasteProfiles: ['清淡'] },
      },
    }];
    assert.equal(validateGroundedAgentAnswer({
      answer: '这道菜口味清淡。', citationIds: ['dish:estimated'],
    }, estimated).reason, 'MISSING_ESTIMATION_LABEL');
    assert.equal(validateGroundedAgentAnswer({
      answer: 'AI预标注估算这道菜可能口味清淡，仍待核验。', citationIds: ['dish:estimated'],
    }, estimated).valid, true);

    const reference = [{
      id: 'food-reference:rice',
      sourceType: 'food_composition_reference',
      evidenceType: 'reference_only',
      metadata: { basisGrams: 100, nutrients: { caloriesKcal: 130 } },
    }];
    assert.equal(validateGroundedAgentAnswer({
      answer: '这种校内菜品每100克是130千卡。', citationIds: ['food-reference:rice'],
    }, reference).reason, 'MISSING_REFERENCE_BOUNDARY');
    assert.equal(validateGroundedAgentAnswer({
      answer: '参考食材每100克参考值为130千卡，不能代表校内菜品。', citationIds: ['food-reference:rice'],
    }, reference).valid, true);
  });

  it('applies AI estimation boundaries to estimated fields instead of verified catalog fields', () => {
    const citations = [{
      id: 'dish:mixed',
      sourceType: 'dish',
      metadata: {
        priceDisplay: '12元/份',
        semanticEvidenceTypes: ['tenant_dish_fact', 'ai_estimated'],
        aiEstimated: { tasteProfiles: ['清淡'], cookingMethods: ['蒸'] },
      },
    }];
    assert.equal(validateGroundedAgentAnswer({
      answer: '该菜品目录价格为12元/份。', citationIds: ['dish:mixed'],
    }, citations).valid, true);
    assert.equal(validateGroundedAgentAnswer({
      answer: '该菜品口味清淡。', citationIds: ['dish:mixed'],
    }, citations).reason, 'MISSING_ESTIMATION_LABEL');

    const locationOverlap = [{
      id: 'dish:location-overlap',
      sourceType: 'dish',
      title: '黄金蝴蝶架',
      metadata: {
        stallName: '临榆炸鸡腿',
        semanticEvidenceTypes: ['tenant_dish_fact', 'ai_estimated'],
        aiEstimated: { cookingMethods: ['炸'], scenarioTags: ['炸鸡'] },
      },
    }];
    assert.equal(validateGroundedAgentAnswer({
      answer: '黄金蝴蝶架位于临榆炸鸡腿档口。', citationIds: ['dish:location-overlap'],
    }, locationOverlap).valid, true);
  });

  it('accepts explicit safety negation while rejecting unsupported positive safety claims', () => {
    const citations = [{ id: 'dish:unknown', sourceType: 'dish', metadata: { safetyStatus: 'unknown' } }];
    assert.equal(validateGroundedAgentAnswer({
      answer: '过敏原信息尚未确认，目前不能放心吃，请现场核实交叉接触风险。',
      citationIds: ['dish:unknown'],
    }, citations).valid, true);
    assert.equal(validateGroundedAgentAnswer({
      answer: '过敏原信息尚未确认，无法确认能否放心食用，请现场核实交叉接触风险。',
      citationIds: ['dish:unknown'],
    }, citations).valid, true);
    assert.equal(validateGroundedAgentAnswer({
      answer: '过敏原信息尚未确认，无法确认是否能放心吃，请现场核实交叉接触风险。',
      citationIds: ['dish:unknown'],
    }, citations).valid, true);
    assert.equal(validateGroundedAgentAnswer({
      answer: '过敏原信息尚未确认，但可以放心吃。', citationIds: ['dish:unknown'],
    }, citations).reason, 'UNSUPPORTED_SAFETY_CLAIM');
  });

  it('builds citation-scoped requirements and exact safety statements', () => {
    const requirements = buildGroundedAnswerRequirements([{
      id: 'dish:unknown',
      sourceType: 'dish',
      evidenceClasses: ['tenant_fact', 'ai_estimated'],
      metadata: {
        safetyStatus: 'unknown',
        supplyConfirmed: false,
        nutritionFactStatus: 'unknown',
        estimatedTerms: ['清淡'],
      },
    }]);
    assert.equal(requirements.promptVersion, 'grounded-answer-v2');
    assert.deepEqual(requirements.allowedCitationIds, ['dish:unknown']);
    assert.equal(requirements.evidenceRules[0].requiresAllergenUnknownWarning, true);
    assert.equal(requirements.evidenceRules[0].requiresSupplyUnconfirmedWarning, true);
    assert.equal(requirements.evidenceRules[0].nutritionUnverified, true);
    assert.deepEqual(requirements.evidenceRules[0].estimatedTerms, ['清淡']);
    assert.match(requirements.exactStatements.allergenUnknown, /尚未确认.*现场核实/);
  });
});
