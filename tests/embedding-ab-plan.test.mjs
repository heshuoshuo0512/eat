import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = readFileSync(resolve('scripts/evaluate-embedding-ab.mjs'), 'utf8');

describe('embedding A/B experiment plan', () => {
  it('defines raw and enhanced 0.6B/8B groups with their real dimensions', () => {
    for (const id of ['raw-qwen06', 'enhanced-qwen06', 'raw-qwen8b', 'enhanced-qwen8b']) assert.match(script, new RegExp(`id: '${id}'`));
    assert.match(script, /qwen3-embedding:0\.6b'[\s\S]+dimension: 1024/);
    assert.match(script, /qwen3-embedding:8b-fp16'[\s\S]+dimension: 1024/);
  });

  it('blocks empty enhanced runs and applies the declared 8B acceptance threshold', () => {
    assert.match(script, /validatedAnnotationCount !== 200/);
    assert.match(script, /gain >= 0\.01 && p95 <= 2500/);
    assert.match(script, /evaluate-real-catalog-retrieval\.mjs/);
    assert.match(script, /evaluate-multi-source-retrieval\.mjs/);
    assert.match(script, /--reuse-reports/);
    assert.match(script, /rawModelComparison/);
    assert.match(script, /multiSourceNdcgAt5Gain/);
    assert.match(script, /multiSourceLatencyP95Ratio/);
    assert.match(script, /recommendedModel: accepted8b/);
    assert.match(script, /rejectionReasons/);
  });

  it('supports resumable multi-source evaluation checkpoints for slow local models', () => {
    const evaluator = readFileSync(resolve('scripts/evaluate-multi-source-retrieval.mjs'), 'utf8');
    assert.match(evaluator, /--resume/);
    assert.match(evaluator, /checkpointEvery/);
    assert.match(evaluator, /status = 'partial'/);
  });

  it('supports resumable real-catalog evaluation checkpoints', () => {
    const evaluator = readFileSync(resolve('scripts/evaluate-real-catalog-retrieval.mjs'), 'utf8');
    assert.match(evaluator, /--resume/);
    assert.match(evaluator, /checkpointEvery/);
    assert.match(evaluator, /writeCheckpoint/);
    assert.match(evaluator, /status = 'partial'/);
  });
});
