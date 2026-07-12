/**
 * LangChain Agent - Industry Standard Implementation
 * 
 * Uses LangChain's AgentExecutor with ReAct pattern:
 * - Dynamic tool registration via @tool decorator
 * - ReAct reasoning loop (Reason → Act → Observe)
 * - Multi-step tool chaining
 * - Memory integration
 */

import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { DynamicTool } from '@langchain/core/tools';
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { isAiProviderEnabled, providerConfig } from './aiProvider.js';

/* ── Configuration ──────────────────────────────────────────────────── */

const AGENT_MODEL = 'gpt-4o-mini';
const MAX_ITERATIONS = 5;
const MAX_TOKENS = 2048;

/* ── Tool Registry ────────────────────────────────────────────────────── */

/**
 * Dynamic tool registry - tools register themselves.
 * Unlike the hardcoded 9 tools, this supports runtime registration.
 */
class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.categories = new Map();
  }

  /**
   * Register a tool.
   * @param {Object} options - Tool options
   * @param {string} options.name - Tool name (unique identifier)
   * @param {string} options.description - Tool description for LLM
   * @param {Function} options.func - Tool function
   * @param {Object} options.schema - JSON schema for parameters
   * @param {string} options.category - Tool category
   * @param {string} options.riskLevel - Risk level (low/medium/high)
   * @param {string[]} options.roles - Allowed roles (null = all)
   * @param {boolean} options.requiresConfirmation - Whether user confirmation is required
   */
  register(options) {
    const { name, description, func, schema, category = 'general', riskLevel = 'low', roles = null, requiresConfirmation = false } = options;
    
    const tool = new DynamicTool({
      name,
      description,
      func: async (input) => {
        try {
          const result = await func(typeof input === 'string' ? JSON.parse(input) : input);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      },
      schema,
    });

    this.tools.set(name, { tool, options });
    
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    this.categories.get(category).push(name);
    
    return this;
  }

  /**
   * Get tool by name.
   */
  get(name) {
    return this.tools.get(name)?.tool;
  }

  /**
   * Get all tools for a user (filtered by role).
   */
  getToolsForUser(user = null) {
    const tools = [];
    for (const [name, { tool, options }] of this.tools) {
      if (options.roles && user && !options.roles.includes(user.role)) {
        continue;
      }
      tools.push(tool);
    }
    return tools;
  }

  /**
   * Get tool catalog (for API response).
   */
  getCatalog() {
    const catalog = [];
    for (const [name, { options }] of this.tools) {
      catalog.push({
        name: options.name,
        description: options.description,
        category: options.category,
        riskLevel: options.riskLevel,
        requiresConfirmation: options.requiresConfirmation,
        schema: options.schema,
      });
    }
    return catalog;
  }

  /**
   * Get tools by category.
   */
  getByCategory(category) {
    const toolNames = this.categories.get(category) || [];
    return toolNames.map(name => this.tools.get(name)?.tool).filter(Boolean);
  }
}

// Global tool registry instance
const globalToolRegistry = new ToolRegistry();

/* ── Built-in Tools ────────────────────────────────────────────────────── */

/**
 * Register built-in canteen tools.
 * These replace the hardcoded 9 tools with dynamic registration.
 */
export function registerCanteenTools(db, user) {
  const registry = new ToolRegistry();
  const tenantId = user?.tenant_id || user?.tenantId || 'default';
  const requireUser = () => {
    if (!user?.id) throw new Error('需要登录用户');
    return user.id;
  };

  registry.register({
    name: 'session.load',
    description: '加载会话记忆，获取之前的对话上下文',
    category: 'memory',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: { sessionId: { type: 'string' } } },
    func: async ({ sessionId }) => {
      const userId = requireUser();
      if (!sessionId) return { error: '需要 sessionId' };
      const session = await db.prepare(
        'SELECT id FROM agent_sessions WHERE tenant_id = ? AND user_id = ? AND id = ?'
      ).get(tenantId, userId, sessionId);
      if (!session) return { error: '会话不存在或无权访问' };
      const messages = await db.prepare(
        `SELECT role, content, created_at FROM agent_messages
         WHERE tenant_id = ? AND user_id = ? AND session_id = ?
         ORDER BY created_at DESC LIMIT 10`
      ).all(tenantId, userId, sessionId);
      return { messages };
    },
  });

  registry.register({
    name: 'memory.long_term',
    description: '读取用户长期偏好记忆，如口味偏好、饮食禁忌等',
    category: 'memory',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: {} },
    func: async () => {
      const userId = requireUser();
      const memory = await db.prepare(
        'SELECT summary, preferences_json FROM agent_memories WHERE tenant_id = ? AND user_id = ?'
      ).get(tenantId, userId);
      return {
        memory: memory ? {
          summary: memory.summary || '',
          preferences: JSON.parse(memory.preferences_json || '{}'),
        } : { summary: '', preferences: {} },
      };
    },
  });

  registry.register({
    name: 'profile.load',
    description: '读取用户营养档案，包括身高、体重、健康目标等',
    category: 'context',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: {} },
    func: async () => {
      const userId = requireUser();
      const profile = await db.prepare(
        'SELECT * FROM health_profiles WHERE tenant_id = ? AND user_id = ?'
      ).get(tenantId, userId);
      return { profile: profile || {} };
    },
  });

  registry.register({
    name: 'menu.today',
    description: '读取今日已发布的菜单，包括所有食堂和档口的菜品',
    category: 'canteen',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: { mealType: { type: 'string' }, date: { type: 'string' } } },
    func: async ({ mealType = 'lunch', date } = {}) => {
      const today = date || new Date().toISOString().slice(0, 10);
      const menus = await db.prepare(
        `SELECT m.*, mi.*, d.name AS dish_name, d.price AS dish_price,
                s.name AS stall_name, c.name AS canteen_name
         FROM menus m
         JOIN menu_items mi ON mi.menu_id = m.id AND mi.tenant_id = m.tenant_id
         JOIN dishes d ON d.id = mi.dish_id AND d.tenant_id = m.tenant_id
         LEFT JOIN stalls s ON s.id = d.stall_id AND s.tenant_id = m.tenant_id
         LEFT JOIN canteens c ON c.id = s.canteen_id AND c.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND m.date = ? AND m.meal_type = ? AND m.status = ?
         ORDER BY m.canteen_id, mi.created_at`
      ).all(tenantId, today, mealType, 'published');
      return { menus, date: today, mealType };
    },
  });

  registry.register({
    name: 'rag.meal_advisor',
    description: '检索菜品知识库并生成个性化饮食建议，基于RAG检索和营养分析',
    category: 'knowledge',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    func: async ({ query }) => {
      const userId = requireUser();
      const { generateGroundedAnswer } = await import('./rag-langchain.js');
      const { listDishes, listStalls, listCanteens } = await import('./app.js');
      const dishes = await listDishes(db, new URLSearchParams(), tenantId);
      const stalls = await listStalls(db, tenantId);
      const canteens = await listCanteens(db, tenantId);
      const profile = await db.prepare(
        'SELECT * FROM health_profiles WHERE tenant_id = ? AND user_id = ?'
      ).get(tenantId, userId);
      return await generateGroundedAnswer({
        query,
        profile: profile || {},
        db,
        dishes,
        stalls,
        canteens,
        tenantId,
      });
    },
  });

  registry.register({
    name: 'orders.mine',
    description: '查询用户自己的订单历史',
    category: 'order',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: { limit: { type: 'number' } } },
    func: async ({ limit = 10 } = {}) => {
      const userId = requireUser();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
      const orders = await db.prepare(
        'SELECT * FROM orders WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(tenantId, userId, safeLimit);
      return { orders };
    },
  });

  registry.register({
    name: 'orders.analytics',
    description: '查看营业数据分析，包括销售额、热销菜品等（需要管理员权限）',
    category: 'analytics',
    riskLevel: 'low',
    requiresConfirmation: false,
    roles: ['admin', 'super_admin', 'tenant_admin', 'canteen_admin', 'operator', 'finance'],
    schema: { type: 'object', properties: { date: { type: 'string' } } },
    func: async ({ date } = {}) => {
      const today = date || new Date().toISOString().slice(0, 10);
      const analytics = await db.prepare(
        `SELECT COUNT(*) AS total_orders, COALESCE(SUM(total_amount), 0) AS total_revenue
         FROM orders WHERE tenant_id = ? AND DATE(created_at) = ?`
      ).get(tenantId, today);
      return { analytics, date: today };
    },
  });

  registry.register({
    name: 'order.create.propose',
    description: '提议创建订单（需要用户确认后才会执行）',
    category: 'order',
    riskLevel: 'high',
    requiresConfirmation: true,
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } }, required: ['items'] },
    func: async ({ items }) => ({
      proposal: true,
      message: '订单提议已创建，等待用户确认',
      items,
    }),
  });

  registry.register({
    name: 'session.save',
    description: '保存会话摘要到长期记忆',
    category: 'memory',
    riskLevel: 'low',
    requiresConfirmation: false,
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    func: async ({ summary }) => {
      const userId = requireUser();
      const timestamp = new Date().toISOString();
      const id = `agent-memory-${userId}`;
      await db.prepare(
        `INSERT INTO agent_memories (id, tenant_id, user_id, summary, preferences_json, updated_at)
         VALUES (?, ?, ?, ?, '{}', ?)
         ON CONFLICT(tenant_id, user_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`
      ).run(id, tenantId, userId, summary, timestamp);
      return { saved: true, summary };
    },
  });

  // Runtime tools are definitions, not request-bound built-ins. Copy them into
  // this request registry so the global registry never captures a user's DB/context.
  for (const [name, { options }] of globalToolRegistry.tools) {
    if (!registry.tools.has(name)) registry.register(options);
  }
  console.log(`[Agent-LangChain] Registered ${registry.tools.size} tools for tenant ${tenantId}`);
  return registry;
}

/* ── Agent Creation ────────────────────────────────────────────────────── */

const REACT_PROMPT_TEMPLATE = `你是智慧食堂的智能助手，可以帮助用户查询菜单、获取饮食建议、管理订单等。

你可以使用以下工具：
{tools}

工具名称列表：{tool_names}

使用以下格式回答问题：

Question: 用户的问题
Thought: 思考应该使用哪个工具
Action: 工具名称
Action Input: 工具的输入参数（JSON格式）
Observation: 工具返回的结果
... (可以重复 Thought/Action/Action Input/Observation)
Thought: 我现在知道最终答案了
Final Answer: 对用户的最终回答

开始！

Question: {input}
Thought: {agent_scratchpad}`;

/**
 * Create a LangChain Agent with ReAct pattern.
 * Uses dynamic tool registration and multi-step reasoning.
 */
export async function createCanteenAgent(db, user, options = {}) {
  const config = providerConfig();
  if (!config.enabled) {
    throw new Error('AI provider not configured');
  }

  // Build per-request tool registry with tenant-scoped closures
  const registry = registerCanteenTools(db, user);

  const model = new ChatOpenAI({
    openAIApiKey: config.apiKey,
    modelName: options.model || AGENT_MODEL,
    temperature: 0.3,
    maxTokens: MAX_TOKENS,
  });

  const tools = registry.getToolsForUser(user);

  const prompt = PromptTemplate.fromTemplate(REACT_PROMPT_TEMPLATE);

  const agent = await createReactAgent({
    llm: model,
    tools,
    prompt,
  });

  const memory = new BufferMemory({
    memoryKey: 'chat_history',
    returnMessages: true,
  });

  const executor = new AgentExecutor({
    agent,
    tools,
    memory,
    maxIterations: options.maxIterations || MAX_ITERATIONS,
    verbose: options.verbose || false,
    handleParsingErrors: true,
  });

  return executor;
}

/* ── Agent Execution ────────────────────────────────────────────────────── */

/**
 * Run the canteen agent with a query.
 * Returns structured result with steps, tool calls, and final answer.
 */
export async function runCanteenAgent(db, user, query, options = {}) {
  const startTime = Date.now();
  
  try {
    const executor = await createCanteenAgent(db, user, options);
    
    const result = await executor.invoke({
      input: query,
    });

    const latencyMs = Date.now() - startTime;

    // Extract steps from intermediate outputs
    const steps = result.intermediateSteps?.map(step => ({
      tool: step.action.tool,
      input: step.action.toolInput,
      output: step.observation,
    })) || [];

    return {
      answer: result.output,
      steps,
      toolCalls: steps.length,
      latencyMs,
      source: 'langchain-agent',
    };
  } catch (err) {
    console.error('[Agent-LangChain] Agent failed:', err.message);
    
    // Fallback to legacy agent
    const { runCanteenAgent: legacyAgent } = await import('./app.js');
    return await legacyAgent(db, user, { query, ...options });
  }
}

/* ── Memory Types ──────────────────────────────────────────────────────── */

/**
 * Create conversation summary memory.
 * Useful for long conversations to avoid token limits.
 */
export function createSummaryMemory(llm) {
  return new ConversationSummaryMemory({
    llm,
    memoryKey: 'chat_history',
    returnMessages: true,
  });
}

/**
 * Create buffer memory (keeps all messages).
 * Useful for short conversations.
 */
export function createBufferMemory() {
  return new BufferMemory({
    memoryKey: 'chat_history',
    returnMessages: true,
  });
}

/**
 * Episodic memory - stores specific interaction episodes.
 * Useful for recalling past conversations and their outcomes.
 */
export class EpisodicMemory {
  constructor(db, userId) {
    this.db = db;
    this.userId = userId;
    this.episodes = [];
  }

  /**
   * Record an episodic memory.
   * @param {Object} episode - The episode to record
   * @param {string} episode.query - User query
   * @param {string} episode.answer - Agent answer
   * @param {string[]} episode.tools - Tools used
   * @param {Object} episode.outcome - Outcome metadata
   */
  async record(episode) {
    const id = `episode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    await this.db.prepare(
      `INSERT INTO agent_memories (id, user_id, type, content, metadata_json, created_at)
       VALUES (?, ?, 'episodic', ?, ?, ?)`
    ).run(
      id,
      this.userId,
      JSON.stringify({
        query: episode.query,
        answer: episode.answer?.slice(0, 500),
        tools: episode.tools || [],
      }),
      JSON.stringify(episode.outcome || {}),
      timestamp
    );

    this.episodes.push({ id, ...episode, timestamp });
    return { id, timestamp };
  }

  /**
   * Recall similar episodes based on query similarity.
   */
  async recall(query, limit = 5) {
    const rows = await this.db.prepare(
      `SELECT * FROM agent_memories 
       WHERE user_id = ? AND type = 'episodic' 
       ORDER BY created_at DESC 
       LIMIT ?`
    ).all(this.userId, limit * 3);

    // Simple keyword matching for recall
    const queryTokens = new Set(query.toLowerCase().split(/\s+/));
    const scored = rows.map(row => {
      const content = JSON.parse(row.content || '{}');
      const contentTokens = new Set(
        (content.query || '').toLowerCase().split(/\s+/)
      );
      const overlap = [...queryTokens].filter(t => contentTokens.has(t)).length;
      return { ...row, score: overlap / Math.max(queryTokens.size, 1) };
    });

    return scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        query: JSON.parse(r.content || '{}').query,
        answer: JSON.parse(r.content || '{}').answer,
        tools: JSON.parse(r.content || '{}').tools || [],
        score: r.score,
        timestamp: r.created_at,
      }));
  }

  /**
   * Get recent episodes.
   */
  async recent(limit = 10) {
    const rows = await this.db.prepare(
      `SELECT * FROM agent_memories 
       WHERE user_id = ? AND type = 'episodic' 
       ORDER BY created_at DESC 
       LIMIT ?`
    ).all(this.userId, limit);

    return rows.map(r => ({
      id: r.id,
      ...JSON.parse(r.content || '{}'),
      metadata: JSON.parse(r.metadata_json || '{}'),
      timestamp: r.created_at,
    }));
  }

  /**
   * Create episodic memory instance.
   */
  static create(db, userId) {
    return new EpisodicMemory(db, userId);
  }
}

/* ── Tool Registration API ────────────────────────────────────────────── */

/**
 * Register a custom tool at runtime.
 * This is the dynamic tool registration that replaces hardcoded tools.
 */
export function registerTool(options) {
  return globalToolRegistry.register(options);
}

/**
 * Get the global tool registry.
 */
export function getToolRegistry() {
  return globalToolRegistry;
}

/* ── Export ────────────────────────────────────────────────────────────── */

export {
  ToolRegistry,
  globalToolRegistry,
  AGENT_MODEL,
  MAX_ITERATIONS,
};
