# 全国高校饮食语义底座

该目录保存全国高校通用的校园饮食语义与固定评测集。它用于名称归一化、查询理解、软排序和解释，不是任何学校的真实菜单。

## 文件

- `00_manifest.json`：版本、全局作用域、分类配额和使用边界。
- `concepts.json`：500 个已批准概念，严格按 220/90/60/40/40/30/20 分类。
- `evaluation-queries.json`：300 条完整标注查询，只用于评测，不进入 RAG 索引。

## 安全边界

1. 菜品原型不得作为可售菜品，也不得自动生成价格、配方、营养、过敏原、库存或供应状态。
2. 当前学校的业务事实只来自当前租户数据库。
3. `过敏原未知` 不等于无过敏原；过敏、忌口、清真和饮食模式不得自动放宽。
4. 只有 `approved` 概念会编译为 `campus_dining_knowledge` 检索文档。
5. 全国语义写入 `__global__`，学校菜品仍按租户隔离。

## 维护

重新生成固定数据：

```bash
npm run generate:campus-kb
```

执行严格校验：

```bash
npm run validate:campus-kb
```

构建不含远程向量的词法索引：

```bash
node scripts/reindex-retrieval.mjs --tenant=__global__ --source=campus_dining_knowledge,health_knowledge --lexical-only
```

配置兼容 OpenAI 的 Embedding 服务后，移除 `--lexical-only` 即可生成 1536 维向量。向量存储在数据库，不提交到仓库。
