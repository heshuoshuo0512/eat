/**
 * RAGAS-like Evaluation Framework - Industry Standard
 * 
 * Implements RAG evaluation metrics:
 * - Faithfulness: Is the answer grounded in the context?
 * - Answer Relevancy: Does the answer address the question?
 * - Context Precision: Are the retrieved contexts relevant?
 * - Context Recall: Does the context cover the answer?
 * 
 * Based on RAGAS paper: https://arxiv.org/abs/2309.15217
 */

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { providerConfig } from './aiProvider.js';

/* ── Configuration ──────────────────────────────────────────────────── */

const EVAL_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;

/* ── Prompts ──────────────────────────────────────────────────────────── */

const FAITHFULNESS_PROMPT = `你是一个严格的事实核查员。请评估以下回答是否基于给定的上下文。

规则：
1. 只检查回答中的事实声明是否在上下文中有依据
2. 如果回答中的某个声明在上下文中没有依据，标记为不忠实
3. 推理和总结是允许的，只要它们基于上下文

上下文：
{context}

问题：{question}

回答：{answer}

请评估回答的忠实度（0-1之间的小数），并解释原因。

输出格式：
score: <分数>
reason: <原因>`;

const ANSWER_RELEVANCY_PROMPT = `你是一个问答质量评估员。请评估以下回答是否与问题相关。

规则：
1. 回答应该直接回应问题
2. 回答不应该包含与问题无关的信息
3. 回答应该是完整和有帮助的

问题：{question}

回答：{answer}

请评估回答的相关度（0-1之间的小数），并解释原因。

输出格式：
score: <分数>
reason: <原因>`;

const CONTEXT_PRECISION_PROMPT = `你是一个检索质量评估员。请评估以下检索到的上下文是否与问题相关。

规则：
1. 上下文应该包含回答问题所需的信息
2. 不相关的上下文会降低精度分数
3. 顺序也很重要 - 相关上下文应该排在前面

问题：{question}

检索到的上下文：
{contexts}

请评估上下文的精度（0-1之间的小数），并解释原因。

输出格式：
score: <分数>
reason: <原因>`;

const CONTEXT_RECALL_PROMPT = `你是一个检索覆盖率评估员。请评估以下检索到的上下文是否覆盖了参考答案中的信息。

规则：
1. 参考答案中的每个关键信息点都应该在上下文中有依据
2. 如果上下文缺少参考答案中的关键信息，降低召回率分数

参考答案：{ground_truth}

检索到的上下文：
{contexts}

请评估上下文的召回率（0-1之间的小数），并解释原因。

输出格式：
score: <分数>
reason: <原因>`;

/* ── LLM Evaluator ──────────────────────────────────────────────────── */

function getEvaluator() {
  const config = providerConfig();
  if (!config.enabled) {
    throw new Error('AI provider not configured for evaluation');
  }
  
  return new ChatOpenAI({
    openAIApiKey: config.apiKey,
    modelName: EVAL_MODEL,
    temperature: 0,
    maxTokens: MAX_TOKENS,
  });
}

/**
 * Parse evaluation score from LLM response.
 */
function parseScore(response) {
  const match = response.match(/score:\s*([\d.]+)/i);
  if (match) {
    return Math.min(1, Math.max(0, parseFloat(match[1])));
  }
  return 0.5; // Default if parsing fails
}

/**
 * Parse evaluation reason from LLM response.
 */
function parseReason(response) {
  const match = response.match(/reason:\s*(.+)/i);
  return match ? match[1].trim() : '';
}

/* ── Faithfulness Metric ──────────────────────────────────────────────── */

/**
 * Evaluate faithfulness: Is the answer grounded in the context?
 * 
 * @param {Object} params
 * @param {string} params.question - The original question
 * @param {string} params.answer - The generated answer
 * @param {string[]} params.contexts - The retrieved contexts
 * @returns {Promise<{score: number, reason: string}>}
 */
export async function evaluateFaithfulness({ question, answer, contexts }) {
  const llm = getEvaluator();
  const prompt = PromptTemplate.fromTemplate(FAITHFULNESS_PROMPT);
  
  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  
  const result = await chain.invoke({
    question,
    answer,
    context: contexts.join('\n\n'),
  });
  
  return {
    score: parseScore(result),
    reason: parseReason(result),
    metric: 'faithfulness',
  };
}

/* ── Answer Relevancy Metric ──────────────────────────────────────────── */

/**
 * Evaluate answer relevancy: Does the answer address the question?
 * 
 * @param {Object} params
 * @param {string} params.question - The original question
 * @param {string} params.answer - The generated answer
 * @returns {Promise<{score: number, reason: string}>}
 */
export async function evaluateAnswerRelevancy({ question, answer }) {
  const llm = getEvaluator();
  const prompt = PromptTemplate.fromTemplate(ANSWER_RELEVANCY_PROMPT);
  
  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  
  const result = await chain.invoke({
    question,
    answer,
  });
  
  return {
    score: parseScore(result),
    reason: parseReason(result),
    metric: 'answer_relevancy',
  };
}

/* ── Context Precision Metric ─────────────────────────────────────────── */

/**
 * Evaluate context precision: Are the retrieved contexts relevant?
 * 
 * @param {Object} params
 * @param {string} params.question - The original question
 * @param {string[]} params.contexts - The retrieved contexts
 * @returns {Promise<{score: number, reason: string}>}
 */
export async function evaluateContextPrecision({ question, contexts }) {
  const llm = getEvaluator();
  const prompt = PromptTemplate.fromTemplate(CONTEXT_PRECISION_PROMPT);
  
  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  
  const result = await chain.invoke({
    question,
    contexts: contexts.map((ctx, i) => `[${i + 1}] ${ctx}`).join('\n\n'),
  });
  
  return {
    score: parseScore(result),
    reason: parseReason(result),
    metric: 'context_precision',
  };
}

/* ── Context Recall Metric ────────────────────────────────────────────── */

/**
 * Evaluate context recall: Does the context cover the answer?
 * 
 * @param {Object} params
 * @param {string} params.ground_truth - The reference answer
 * @param {string[]} params.contexts - The retrieved contexts
 * @returns {Promise<{score: number, reason: string}>}
 */
export async function evaluateContextRecall({ ground_truth, contexts }) {
  const llm = getEvaluator();
  const prompt = PromptTemplate.fromTemplate(CONTEXT_RECALL_PROMPT);
  
  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  
  const result = await chain.invoke({
    ground_truth,
    contexts: contexts.map((ctx, i) => `[${i + 1}] ${ctx}`).join('\n\n'),
  });
  
  return {
    score: parseScore(result),
    reason: parseReason(result),
    metric: 'context_recall',
  };
}

/* ── Composite Evaluation ────────────────────────────────────────────── */

/**
 * Run all RAGAS metrics on a single example.
 * 
 * @param {Object} params
 * @param {string} params.question - The original question
 * @param {string} params.answer - The generated answer
 * @param {string[]} params.contexts - The retrieved contexts
 * @param {string} params.ground_truth - The reference answer (optional)
 * @returns {Promise<Object>} All metric scores
 */
export async function evaluateRAGExample({ question, answer, contexts, ground_truth }) {
  const metrics = {};
  
  // Run all metrics in parallel
  const [faithfulness, answerRelevancy, contextPrecision] = await Promise.all([
    evaluateFaithfulness({ question, answer, contexts }),
    evaluateAnswerRelevancy({ question, answer }),
    evaluateContextPrecision({ question, contexts }),
  ]);
  
  metrics.faithfulness = faithfulness;
  metrics.answer_relevancy = answerRelevancy;
  metrics.context_precision = contextPrecision;
  
  // Context recall requires ground truth
  if (ground_truth) {
    metrics.context_recall = await evaluateContextRecall({ ground_truth, contexts });
  }
  
  // Calculate overall score
  const scores = Object.values(metrics).map(m => m.score);
  metrics.overall_score = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  return metrics;
}

/* ── Batch Evaluation ────────────────────────────────────────────────── */

/**
 * Run RAGAS evaluation on a batch of examples.
 * 
 * @param {Object[]} examples - Array of example objects
 * @returns {Promise<Object>} Aggregated metrics
 */
export async function evaluateBatch(examples) {
  const results = [];
  
  for (const example of examples) {
    const result = await evaluateRAGExample(example);
    results.push(result);
  }
  
  // Aggregate metrics
  const aggregated = {};
  const metricNames = ['faithfulness', 'answer_relevancy', 'context_precision', 'context_recall'];
  
  for (const metric of metricNames) {
    const scores = results
      .filter(r => r[metric])
      .map(r => r[metric].score);
    
    if (scores.length > 0) {
      aggregated[metric] = {
        mean: scores.reduce((a, b) => a + b, 0) / scores.length,
        min: Math.min(...scores),
        max: Math.max(...scores),
        std: Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - aggregated[metric]?.mean || 0, 2), 0) / scores.length),
      };
    }
  }
  
  // Overall score
  const overallScores = results.map(r => r.overall_score);
  aggregated.overall = {
    mean: overallScores.reduce((a, b) => a + b, 0) / overallScores.length,
    min: Math.min(...overallScores),
    max: Math.max(...overallScores),
  };
  
  return {
    metrics: aggregated,
    results,
    count: results.length,
  };
}

/* ── Evaluation Pipeline ────────────────────────────────────────────── */

/**
 * Create an evaluation pipeline for the canteen RAG system.
 * 
 * @param {Object} db - Database connection
 * @returns {Object} Evaluation pipeline
 */
export function createEvaluationPipeline(db) {
  return {
    /**
     * Evaluate a single RAG query.
     */
    async evaluateQuery(query, options = {}) {
      const { generateGroundedAnswer } = await import('./rag-langchain.js');
      const { buildDishDocuments } = await import('./rag.js');
      
      // Get documents
      const dishes = await db.prepare('SELECT * FROM dishes').all();
      const stalls = await db.prepare('SELECT * FROM stalls').all();
      const canteens = await db.prepare('SELECT * FROM canteens').all();
      
      // Generate answer
      const result = await generateGroundedAnswer({
        query,
        profile: options.profile || {},
        db,
        dishes,
        stalls,
        canteens,
      });
      
      // Evaluate
      const metrics = await evaluateRAGExample({
        question: query,
        answer: result.answer,
        contexts: result.citations?.map(c => c.snippet || c.content) || [],
        ground_truth: options.ground_truth,
      });
      
      return {
        query,
        answer: result.answer,
        citations: result.citations,
        metrics,
      };
    },
    
    /**
     * Run evaluation on a test set.
     */
    async evaluateTestSet(testCases) {
      const results = [];
      
      for (const testCase of testCases) {
        const result = await this.evaluateQuery(testCase.query, {
          ground_truth: testCase.expected_answer,
          profile: testCase.profile,
        });
        results.push(result);
      }
      
      // Aggregate
      const aggregated = {};
      const metricNames = ['faithfulness', 'answer_relevancy', 'context_precision', 'context_recall'];
      
      for (const metric of metricNames) {
        const scores = results
          .filter(r => r.metrics[metric])
          .map(r => r.metrics[metric].score);
        
        if (scores.length > 0) {
          aggregated[metric] = {
            mean: scores.reduce((a, b) => a + b, 0) / scores.length,
            min: Math.min(...scores),
            max: Math.max(...scores),
          };
        }
      }
      
      return {
        metrics: aggregated,
        results,
        count: results.length,
      };
    },
    
    /**
     * Save evaluation results to database.
     */
    async saveResults(results, runId) {
      for (const result of results.results) {
        await db.prepare(
          `INSERT INTO agent_eval_runs 
           (id, session_id, intent, tool_count, action_count, risk_level, 
            groundedness_score, tool_success_rate, safety_score, latency_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `eval-${runId}-${Date.now()}`,
          'evaluation',
          'rag_evaluation',
          0,
          0,
          'low',
          result.metrics.faithfulness?.score || 0,
          result.metrics.answer_relevancy?.score || 0,
          result.metrics.context_precision?.score || 0,
          0,
          new Date().toISOString()
        );
      }
      
      return { saved: results.results.length };
    },
  };
}

/* ── Export ────────────────────────────────────────────────────────────── */

export {
  EVAL_MODEL,
  FAITHFULNESS_PROMPT,
  ANSWER_RELEVANCY_PROMPT,
  CONTEXT_PRECISION_PROMPT,
  CONTEXT_RECALL_PROMPT,
};
