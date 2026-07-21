# 双检索与 Agent 升级摘要

更新日期：2026-07-21

## 已完成

- 将“菜品查询”和“智能推荐”拆成独立工作流，避免找菜接口隐式执行个性化推荐。
- 新增基于 Zod 的请求解释、数据库硬约束、中文词法检索、精确匹配、语义召回和 RRF 融合。
- 推荐默认返回 3 个独立备选，仅在用户明确要求时生成总价受限的组合餐。
- 菜品证据与健康知识证据分开；无实时菜单时明确返回不可下单参考和告警。
- 增加 `POST /api/dishes/search` 与 `POST /api/recommend`，并保留原有 GET 推荐和 Agent 兼容入口。
- Agent 增加 `dish.search`、`meal.recommend`、`knowledge.search` 及对应意图，工具步骤只记录实际执行。
- PostgreSQL 切换为 `pgvector/pgvector:pg17`，索引统一为 1536 维、HNSW 和 `pg_trgm`。
- 新增租户安全文档 ID、逻辑唯一约束、内容哈希、查询 embedding 缓存、索引状态和幂等重建脚本。
- 菜品页面接入找菜接口；推荐页首屏使用确定性推荐，追问继续使用 Agent。
- 移除未进入生产主链且无法稳定导入的 LangChain 实验模块、相关依赖和仅检查源码字符串的测试。

## 当前生产主链

```text
API / Agent
  -> retrievalService.js（Zod、硬约束、排序、证据）
  -> PostgreSQL 业务表（价格、库存、供应、权限真值）
  -> retrievalIndex.js（pg_trgm + pgvector + RRF）
  -> aiProvider.js（可选 embedding 与 Agent 工具选择）
```

SQLite 仅作为本地开发和单元测试降级路径；正式检索底座是 PostgreSQL + pgvector。

## 不采用 LangChain / LangGraph

当前工作流是边界明确的有限管线，普通 JavaScript 和 Zod 更容易保证 SQL 硬约束先于语义排序，也更容易测试和审计。现有 `aiProvider.js` 已提供所需模型能力，引入 LangChain 不会增加必要能力，反而增加依赖和运行时兼容风险。

LangGraph 适合需要暂停恢复、复杂循环、多阶段人工审批和分布式状态管理的长流程。当前双检索不具备这些需求，因此本期不引入；未来 Agent 工作流明显扩展后再评估。

## 运维命令

```bash
# 所有活动租户
node --env-file=.env scripts/reindex-retrieval.mjs

# 单租户或无 embedding 降级重建
node --env-file=.env scripts/reindex-retrieval.mjs --tenant=default
node --env-file=.env scripts/reindex-retrieval.mjs --tenant=default --lexical-only

# Compose 正式环境
docker compose exec api node scripts/reindex-retrieval.mjs --tenant=default
```

生产启动必须满足：

- PostgreSQL 镜像包含 pgvector；
- 迁移账号可创建 `vector` 和 `pg_trgm` 扩展；
- `rag_documents.embedding` 为 `vector(1536)`；
- HNSW 与 trigram 索引创建成功；
- 首次部署后完成索引重建并检查失败数量。

## 验证状态

- 双检索服务、SQLite 降级、租户隔离、维度校验和索引契约已有自动化测试。
- 上线前仍需在目标 PostgreSQL 环境执行真实扩展、HNSW、中文检索和重建验收；文档不使用未经实测的延迟或质量提升数字。
