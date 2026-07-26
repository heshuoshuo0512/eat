# RAG 本地双模型实验记录

日期：2026-07-26

## 当前分工

- DeepSeek V4 Flash：Agent 意图补充和工具完成后的受约束文字生成。
- Qwen3-Embedding 0.6B：开发机上的 1024 维概念、健康知识与真实菜品向量。
- JavaScript/Zod 规则：过敏、忌口、清真、饮食模式、预算、租户和供应硬约束，优先级高于模型。
- 生产服务器继续使用规则与词法检索，`RETRIEVAL_VECTOR_MODE=off`。

## 已实现

- Chat 与 Embedding 使用独立 Base URL、Key、模型、超时和状态。
- SQLite 实验索引支持 1024 维向量、16-32 条批处理、内容哈希增量跳过和查询缓存。
- `off / shadow / active` 三种模式支持上线前影子对比。
- 精确、词法、向量通过 RRF 融合，真实菜品再按评分和供应状态规则重排。
- Agent 最终回答校验引用 ID 和价格事实；校验失败或模型不可用时返回确定性答案。
- Chat 工具路由使用 3 秒独立超时；路由调用失败后打开请求级熔断，本次请求不再重复等待最终生成调用。
- 菜单检索、供应时段和营业统计统一使用 `Asia/Shanghai` 业务时区，避免 UTC 跨日导致真实菜单被误判为未上架。
- 50 条挑战查询覆盖错别字、口语、长条件、否定和冲突指令，与 300 条冻结评测集分离。

## 真实本机结果

测试数据为 289 条带概念标注的冻结查询和 50 条挑战查询，共 339 条：

| 策略 | Hit@1 | Hit@3 | Hit@5 | P95 |
|---|---:|---:|---:|---:|
| 词法 | 98.53% | 100% | 100% | 22.91ms |
| Qwen 向量 | 93.51% | 98.82% | 99.41% | 201.80ms |
| 混合 RRF | 98.82% | 100% | 100% | 202.23ms |

- 安全约束解析：65/65，100%。
- 首次索引：500 个全局概念、16 个真实菜品、14 个健康知识块，全部成功。
- 全局概念分 21 批完成，向量化约 13.2 秒。
- 第二次重建跳过 500/500 个未变化概念，无重复向量化。
- 入库的评测查询和挑战查询：0。

## 最终验收

- `npm run validate:campus-kb`：500 个概念、300 条冻结查询、50 条挑战查询全部通过 Schema、唯一性和引用完整性校验。
- `npm test`：654/654 通过。
- `npm run build`：Web 生产构建通过。
- `npm run build:miniapp`：微信小程序构建通过。
- 测试 Key 未写入源码、文档或 Git 差异；`package-lock.json` 未改动。

## 使用方式

```powershell
$env:AI_EMBEDDING_BASE_URL='http://127.0.0.1:11434/v1'
$env:AI_EMBEDDING_MODEL='qwen3-embedding:0.6b'
$env:AI_EMBEDDING_DIMENSION='1024'
$env:RETRIEVAL_VECTOR_MODE='active'
npm run eval:rag-local
```

Chat 与业务时区可分别配置 `AI_ROUTING_TIMEOUT_MS` 和 `SMART_CANTEEN_TIME_ZONE`。生产默认应保持 `RETRIEVAL_VECTOR_MODE=off`。

详细报告写入被 Git 忽略的 `.rag-evals/`。本地实验数据库为被忽略的 `data/rag-experiment.sqlite`。

## 上线边界

当前生产机只有 2GB 内存，不部署 Ollama。最终语义模型确定后，再根据其维度设计 PostgreSQL 迁移并重建 HNSW；迁移前只能使用 `off`，上线前先运行 `shadow`，确认安全和租户隔离无回归后才允许 `active`。
