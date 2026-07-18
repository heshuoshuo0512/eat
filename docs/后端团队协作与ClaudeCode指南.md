# 智慧食堂后端团队协作与 Claude Code 开发指南

> 面向：第一次参与本项目、第一次使用 Claude Code 的两位后端开发者  
> 项目：智慧食堂 Smart Canteen  
> 目标：两个人可以安全拉取代码、独立开发 API/数据库/Agent 能力，使用 Claude Code 辅助修改，完成本地验证、Review、合并和交付。

---

# 一、项目后端概况

## 1.1 项目定位

智慧食堂是校园餐饮全栈 MVP。后端负责真实数据、身份认证、租户隔离、权限校验、菜单供应、订单履约、健康推荐、RAG、Agent、文件上传、AI 配置和审计。

后端是系统的**权威数据与安全边界**。前端只负责展示和交互，不能替代后端完成权限、价格、库存、过敏原、订单状态或推荐约束判断。

## 1.2 技术栈

| 部分 | 技术 |
|---|---|
| 运行时 | Node.js 22+、ESM |
| HTTP | Node.js 原生 `node:http` |
| 数据库 | 本地 SQLite（`node:sqlite`） |
| 生产数据库 | PostgreSQL migration，可选 `pgvector` |
| 缓存 | 内存 fallback；Redis 可选 |
| 文件 | 本地 `uploads/` fallback；S3/OSS/MinIO 可选 |
| 认证 | 自定义 HMAC Token、PBKDF2 密码 hash |
| 权限 | RBAC + capability + tenant scope |
| AI | OpenAI-compatible API |
| RAG | 词法检索、确定性本地 embedding、可选远程 embedding、混合检索 |
| Agent | 自研工具注册、权限过滤、风险等级和确认机制；另有 LangChain 实验实现 |
| 测试 | Node.js `node:test` |
| API 端口 | `8787` |

## 1.3 后端目录

```text
server/
├── index.js                 API 启动入口、数据库和缓存初始化
├── app.js                   主 HTTP 应用、路由、请求解析、响应、审计
├── database.js              SQLite/PostgreSQL 数据库适配、schema、seed、row mapper
├── migrations.js            SQL migration 执行器
├── migrations/              版本化 SQL migration
├── security.js              密码 hash、Token、AI Secret 加密、公开用户转换
├── rbac.js                  角色、权限和 requirePermission
├── cache.js                 内存/Redis 缓存
├── storage.js               本地/S3 上传存储及文件校验
├── aiProvider.js            AI 配置、聊天、embedding、视觉识别
├── rag.js                   菜品文档、检索、grounded meal advisor
├── rag-langchain.js         LangChain RAG 实验/兼容实现
├── agent-langchain.js       LangChain Agent 实验实现和工具注册
├── mealVision.js            拍照识餐后的匹配、营养估算和安全提示
└── vectorstore-pgvector.js  PostgreSQL/pgvector 相关能力
```

相关目录：

```text
openapi/smart-canteen.yaml   API 合同
.env.example                 环境变量模板
Dockerfile                   容器构建
docker-compose.yml          API、PostgreSQL、Redis、MinIO、Nginx 编排
 tests/                      API、数据库、权限、Agent、RAG、部署测试
 data/                       本地 SQLite 和知识库数据，不应提交运行时数据库
 uploads/                    本地上传文件，不应提交运行时文件
```

## 1.4 后端核心数据域

数据库包含但不限于：

- `users`：用户、角色、租户
- `tenants`：租户状态、套餐、AI 配额和存储配额
- `canteens`、`stalls`：食堂和档口
- `dishes`：菜品、价格、营养、标签、状态
- `menus`、`menu_items`：日期菜单、供应量、售罄状态
- `reviews`：评价及审核状态
- `health_profiles`：健康目标、预算、餐别、口味、清真和忌口
- `user_dish_preferences`：菜品偏好和行为反馈
- `orders`、`order_items`、`payments`：订单、明细、支付状态
- `uploads`：上传文件元数据
- `rag_documents`：RAG 文档及 embedding
- `agent_sessions`、`agent_messages`、`agent_memories`、`agent_actions`：会话、记忆和高风险动作
- `agent_eval_cases`、`agent_eval_runs`：Agent 评测
- `ai_usage_logs`：AI 调用用量和错误
- `audit_logs`：管理、权限和关键动作审计

## 1.5 关键后端契约

### 推荐契约

推荐结果由服务端生成。核心结构为：

```js
{
  ranked,
  plan,
  context,
  source,
  menu
}
```

前端不得复制推荐算法或自行生成不在数据库中的菜品。

### 数据来源优先级

1. 真实数据库菜品和已发布菜单
2. 供应量、售罄和当前营业状态
3. 用户授权的健康档案和偏好
4. 服务端规则推荐
5. RAG/AI 解释和补充

RAG 和 LLM 不能创造当前价格、库存、供应状态、订单结果或不存在的菜品。

### 安全边界

- AI Key 必须加密存储，响应不得泄漏原文或部分密钥。
- 生产环境 `SMART_CANTEEN_SECRET` 至少 32 个字符且不能使用默认值。
- 上传必须认证，并校验 MIME、Base64 和 5MB 大小限制；服务端生成 storage key。
- 过敏原、明确忌口、清真、停用租户和权限不足必须先过滤/拒绝。
- 下单和支付动作需要用户确认，不能由模型直接执行。
- 评价始终进入待审核流程。
- 菜单删除是归档/状态变更，不应破坏历史订单引用。
- 错误响应不能暴露堆栈、SQL、密钥、密码 hash 或内部配置。

---

# 二、两人后端分工

## 2.1 推荐分工

| 角色 | 主要负责 | 推荐分支 |
|---|---|---|
| 队友 A | API、认证、RBAC、租户、菜单和订单 | `feature/api-...` |
| 队友 B | 数据库、迁移、RAG、Agent、AI、评测和存储 | `feature/agent-...` / `feature/db-...` |

实际分工以任务单为准。后端共享文件多，任何跨模块变更都需要提前通知。

## 2.2 高冲突文件

- `server/app.js`
- `server/database.js`
- `server/security.js`
- `server/rbac.js`
- `openapi/smart-canteen.yaml`
- `.env.example`
- `package.json`、`package-lock.json`
- `docker-compose.yml`
- `.github/workflows/ci.yml`

修改前发送：

```text
我要修改 server/app.js，范围是新增 GET /api/admin/menus/:id/supply，
不改 database.js 和现有响应字段，预计 40 分钟完成。
```

不要为了一个接口顺手重排整个 `app.js`，也不要让 Claude Code 全文件格式化。

## 2.3 后端任务说明模板

```text
任务：增加菜单供应量查询接口
负责人：队友 A
允许修改：server/app.js、openapi/smart-canteen.yaml、tests/menu-supply.test.mjs
需要沟通：数据库字段是否不足时再修改 server/database.js 和 migration
不改：认证算法、订单支付流程、AI 配置
验收：
- 未登录返回 401
- 无权限返回 403
- 只返回当前租户菜单
- 售罄和剩余供应量正确
- API 错误不泄漏 SQL 或堆栈
- 测试和 node --check 通过
```

---

# 三、首次配置和拉取代码

## 3.1 环境准备

Windows 建议安装：

- Node.js 22+
- npm 10+
- Git for Windows
- Claude Code
- VS Code（可选）

检查：

```powershell
node -v
npm -v
git --version
```

配置 Git 身份：

```powershell
git config --global user.name "你的姓名"
git config --global user.email "你的 GitHub 邮箱"
```

## 3.2 安装 Claude Code

```powershell
winget install Anthropic.ClaudeCode
claude --version
```

在项目根目录启动：

```powershell
cd D:\Projects\eat
claude
```

Claude Code 可以使用 Windows PowerShell，不需要强制使用 Git Bash。

## 3.3 克隆和安装

```powershell
git clone https://github.com/heshuoshuo0512/eat.git
cd eat
npm ci
```

首次运行建议用 `npm ci`。只有新增依赖时才用 `npm install 包名`，并同时提交 `package.json` 和 `package-lock.json`。

创建本地环境文件：

```powershell
Copy-Item .env.example .env
```

先阅读 `.env.example`。本地没有 AI、Redis、S3 或 PostgreSQL 时，优先使用默认 SQLite、内存缓存和本地上传 fallback。不要把真实密钥写入 Git。

## 3.4 默认账号和本地数据

| 身份 | 用户名 | 密码 |
|---|---|---|
| 学生 | `演示学生` | `student123` |
| 管理员 | `admin` | `admin123` |

首次启动会创建/迁移本地数据库，并写入演示数据。默认数据库路径：

```text
data/smart-canteen.sqlite
```

不要提交该数据库文件。测试通常使用 `openDatabase(':memory:')`，不要依赖开发者本机数据库状态。

---

# 四、后端日常 Git 流程

## 4.1 创建分支

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/api-menu-supply
```

分支命名：

- `feature/api-描述`
- `feature/db-描述`
- `feature/rag-描述`
- `feature/agent-描述`
- `feature/security-描述`
- `fix/api-描述`
- `test/backend-描述`
- `docs/backend-描述`

禁止直接在 `main` 开发、强制推送、重置他人工作或删除正在使用的远程分支。

## 4.2 开发循环

```powershell
git status
# 修改后
git diff --check
git diff
node --check server/app.js
npm test
npm run build
git add server/app.js openapi/smart-canteen.yaml tests/menu-supply.test.mjs
git diff --staged
git commit -m "feat(api): 增加菜单供应量查询"
git push -u origin feature/api-menu-supply
```

只暂存本任务文件，避免把 `.env`、数据库、上传文件和无关改动放入提交。

## 4.3 提交规范

格式：

```text
<type>(<scope>): <简短说明>
```

示例：

```text
feat(api): 增加菜单供应量接口
fix(auth): 修复过期 Token 拒绝逻辑
fix(db): 修正订单库存回滚事务
feat(rag): 增加菜品事实文档索引
feat(agent): 增加下单确认动作
fix(security): 防止 AI Key 出现在响应
test(api): 增加跨租户访问反例
chore(deps): 更新安全依赖
docs(backend): 更新后端协作指南
```

提交信息中的 ` test(api)` 不应有前导空格；正确写法是：

```text
test(api): 增加跨租户访问反例
```

## 4.4 PR 和 Review

PR 必须说明：

- 新增/修改的 endpoint、请求字段和响应字段
- 数据库表或 migration 变化
- 认证、权限、租户范围变化
- 事务、库存、支付、幂等和并发影响
- AI/RAG/Agent 是否改变事实来源或安全边界
- 测试命令和手动验证方式
- 是否需要新的环境变量、服务或部署步骤

Review 重点：

1. 未登录是否 401，权限不足是否 403。
2. 所有租户查询和写入是否带 tenant scope。
3. 用户是否只能访问自己的订单、会话、上传和健康档案。
4. SQL 是否参数化，动态表名/列名是否来自白名单。
5. 订单创建、支付、库存扣减和回滚是否在正确事务边界内。
6. 菜品删除是否破坏菜单或历史订单。
7. AI Key、Token、密码 hash、内部错误是否泄漏。
8. 请求大小、图片格式、导入行数和频率限制是否保留。
9. OpenAPI 和实际接口是否同步。
10. 测试是否覆盖拒绝路径和反例，而不是只测成功路径。

---

# 五、使用 Claude Code 修改后端

## 5.1 先读后改

第一次进入项目先输入：

```text
请先阅读 README.md、CONTRIBUTING.md、package.json、server/index.js、server/app.js、server/database.js、server/security.js 和 server/rbac.js。
暂时不要修改文件。
请用中文说明：
1. API 启动流程
2. 请求认证和权限流程
3. 数据库初始化、seed 和 migration 流程
4. 当前后端模块边界
5. 我新增接口时必须遵守的安全和测试约束
```

后端任务不能只让 Claude 阅读一个路由函数。必须看调用的数据库、鉴权、序列化和错误处理路径。

## 5.2 后端修改提示词模板

```text
我要新增一个后端接口。

目标：GET /api/admin/menus/:id/supply，返回当前租户指定菜单的供应状态。

允许修改：
- server/app.js
- openapi/smart-canteen.yaml
- tests/menu-supply.test.mjs

如果现有数据库字段不足：先说明需要的 migration，再停止等待方案确认；不要直接改生产 schema。

必须保持：
- Bearer Token 认证
- tenant scope
- RBAC 权限校验
- 参数化 SQL
- 统一 JSON 错误格式和 requestId
- 不泄漏 SQL、堆栈、Token、密钥或密码 hash
- 不改变已有 API 字段

请按顺序：阅读调用关系 → 说明方案 → 修改 → 运行 node --check 和相关测试 → 查看 git diff。
不要提交、push、reset、删除文件或安装依赖。
```

## 5.3 Claude Code 权限安全

可以在确认范围后允许：

- 读取后端文件、OpenAPI 和测试
- 修改指定源码、测试和文档
- 执行 `node --check`、`npm test`、`npm run build`
- 执行 `git status`、`git diff`

必须手动确认：

- 修改 `.env`、密钥、部署文件
- 执行数据库删除、清空或批量迁移
- 安装依赖
- 访问外部 AI、微信、S3 或数据库服务
- `git commit`、`git push`
- 任何生产服务器命令

不要使用：

```text
--dangerously-skip-permissions
```

不要让 Claude 自动执行：

```text
git reset --hard
git push --force
rm -rf data uploads
DROP TABLE ...
```

## 5.4 后端 Review Prompt

```text
请只审查当前 git diff，不要修改文件。
重点检查：
1. 认证、RBAC 和 tenant scope
2. 用户资源归属和越权访问
3. SQL 参数化和动态字段白名单
4. 请求体/上传/导入限制
5. 事务、库存、支付和幂等
6. 错误状态、requestId 和敏感信息泄漏
7. AI Key、密码、Token、审计日志安全
8. RAG 是否引用真实数据库事实
9. Agent 工具的角色、风险等级和确认要求
10. OpenAPI 与测试是否同步
按阻塞、重要、建议列出问题，不要以“看起来没问题”代替证据。
```

---

# 六、API 开发规范

## 6.1 现有接口分类

### 公共接口

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/canteens`
- `GET /api/dishes`
- `GET /api/rankings`
- `POST /api/agent/meal-advisor`

### 登录用户接口

- `POST /api/reviews`
- `POST` 或 `PUT /api/health/profile`
- `POST /api/agent/run`
- 菜单、订单、上传、偏好和会话相关接口

### 管理接口

- `/api/admin/canteens`
- `/api/admin/stalls`
- `/api/admin/dishes`
- `/api/admin/dishes/import`
- `/api/admin/menus`
- `/api/admin/users`
- `/api/admin/ai-settings`
- `/api/admin/ai-usage`
- `/api/admin/audit-logs`

完整合同以 `openapi/smart-canteen.yaml` 和 `server/app.js` 实现为准；修改接口时必须同时核对两者。

## 6.2 统一请求处理

新增接口应遵循现有模式：

1. 解析 `requestId`。
2. 限制请求体大小。
3. 解析 JSON 并处理格式错误。
4. 获取 Token 用户。
5. 检查租户状态。
6. 检查 capability/RBAC。
7. 校验字段、类型、范围和资源归属。
8. 使用参数化 SQL。
9. 写关键动作审计日志。
10. 返回统一 JSON 和 `X-Request-Id`。
11. 错误只返回安全、可理解的信息。

## 6.3 输入和错误

不要相信客户端发送的：

- 用户 ID
- tenant ID
- 角色
- 价格和总价
- 库存和售罄状态
- 订单状态
- 权限
- 菜品营养值

这些字段必须由 Token、数据库和服务端计算决定。对外部输入进行明确校验，保持现有 400/401/403/404/413/415/429/500 语义。

## 6.4 API 兼容

新增字段优先采用向后兼容方式：

- 保留已有字段名和类型
- 新字段设为可选或明确默认值
- 不把数字改成字符串
- 不把对象改成数组
- 不改变错误响应结构
- 更新 OpenAPI、测试和前端调用说明

如果必须破坏兼容，先在 Issue 中说明迁移方案，不直接合并。

---

# 七、数据库和迁移规范

## 7.1 数据库初始化

`server/index.js` 调用 `createDatabase()`；本地默认使用 SQLite，启动时执行 schema/seed/migrations。测试一般通过：

```js
const db = openDatabase(':memory:');
```

修改 schema 前必须确认 SQLite 和 PostgreSQL 路径是否都受影响。

## 7.2 新增字段或表

不要只改 `server/database.js` 的初始 schema。需要：

1. 确定字段、类型、默认值、约束和索引。
2. 新增递增 migration，例如 `server/migrations/005_feature_name.sql`。
3. 更新 SQLite 兼容逻辑和 PostgreSQL migration（如项目已有对应结构）。
4. 更新 row mapper、序列化和 API。
5. 增加迁移成功、旧数据和约束失败测试。
6. 确认 migration 可重复执行或被 `schema_migrations` 正确跳过。
7. 说明回滚/前向修复方式。

迁移文件按编号排序，禁止修改已经在共享环境执行过的 migration；需要修复就新增更高编号的 migration。

## 7.3 数据完整性

- 使用外键和 CHECK 约束表达不变量。
- 订单、支付和库存修改使用事务。
- 价格、总金额和数量由服务端重新计算。
- 历史订单引用的菜品不能物理删除。
- 菜单删除使用归档或状态变更。
- 租户查询、写入、索引和唯一约束考虑 tenant scope。
- JSON 字段解析失败要有安全 fallback，不能让单条坏数据泄漏堆栈。

## 7.4 本地数据操作

开发数据可重建；生产数据不可在本地脚本中假设。不要提交：

- `data/smart-canteen.sqlite`
- 上传图片
- 含个人信息的导出文件
- 真实 AI 配置
- 生产数据库连接串

---

# 八、认证、权限和租户安全

## 8.1 认证

当前安全模块负责：

- PBKDF2 密码 hash
- HMAC Token 签名和过期验证
- AI Secret AES-GCM 加密/解密
- 公开用户字段转换

认证代码任何改动都需要安全 Review 和回归测试。不能用明文密码、弱默认生产密钥或把 Token 放进日志。

## 8.2 RBAC

角色权限由 `server/rbac.js` 定义，常见 capability：

- `review:create`
- `profile:write`
- `upload:create`
- `agent:use`
- `dish:write`
- `dish:bulk_import`
- `canteen:write`
- `review:moderate`
- `user:read`
- `user:write`
- `ai:configure`
- `audit:read`

新增管理接口必须明确 capability，不得用“是不是 admin”替代细粒度权限模型。

## 8.3 Tenant scope

用户的 `tenantId` 来源于认证用户/数据库，不应信任请求体中的 tenant ID。查询和写入必须带租户条件；跨租户读取、更新、删除都应有拒绝测试。

停用租户必须拒绝业务 API。公开健康检查是否可用应遵循现有部署约定，不要把内部状态无意泄漏到公开响应。

---

# 九、订单、上传、AI、RAG 和 Agent 注意事项

## 9.1 订单和支付

订单属于高风险流程。服务端必须：

- 根据真实菜品/菜单重新读取价格
- 检查菜单发布、供应量和售罄
- 校验数量和总金额
- 在正确事务中扣减库存
- 防止重复支付和重复确认
- 生成唯一取餐码/交易号
- 保留取消、退款和库存回滚语义
- 写入必要审计日志

不要相信客户端的 `totalAmount`、`unitPrice`、`status` 或 `paymentStatus`。

## 9.2 上传和视觉识别

`server/storage.js` 当前支持本地 fallback 和 S3 风格存储。上传必须：

- 登录后才能执行
- 仅允许 PNG/JPEG/WebP/GIF
- Base64 可解析且非空
- 最大 5MB
- 服务端生成租户范围 storage key
- 保存元数据，不记录原始密钥

视觉识别只能预填或估算。管理员保存前必须确认菜名、价格、档口和营养；学生端必须显示估算性质。

## 9.3 AI 配置

- API Key 不返回前端。
- 只保存加密值，响应只能返回是否配置、模型和 base URL 等非秘密信息。
- 生产必须设置安全的 `SMART_CANTEEN_SECRET`。
- AI 调用要记录功能、模型、状态、延迟、用量和错误，但不能记录密钥和敏感原文。
- AI 失败应有确定性 fallback 或安全错误，不可静默生成事实。

## 9.4 RAG

RAG 文档分为菜品事实、健康科普、校园运营和 FAQ 等来源。检索结果必须保留来源和引用 ID。

RAG 可以：

- 解释营养概念
- 解释已有菜品和菜单事实
- 补充校园运营规则
- 返回带依据的建议

RAG 不可以：

- 编造不存在的菜品、价格、库存或订单
- 绕过过敏/忌口/清真等硬约束
- 替代数据库的实时状态
- 把模型推断写入事实表而不经确认

## 9.5 Agent 工具

新增工具必须声明：

- 唯一名称
- 参数 schema
- 角色范围
- capability
- 风险等级
- 是否需要用户确认
- 审计动作
- 超时和错误行为

查询类工具通常低风险；下单、支付、改角色、删菜品、改 AI 配置等必须高风险并确认。工具内部仍必须重新做权限和资源归属检查，不能只依赖 LLM 的工具选择。

---

# 十、本地运行、测试和调试

## 10.1 启动 API

```powershell
npm run dev:api
```

默认监听：

```text
http://localhost:8787
```

健康检查：

```text
http://localhost:8787/api/health
```

后端当前不会像 Vite 一样自动热重载。代码修改后按 `Ctrl+C` 停止，再执行：

```powershell
npm run dev:api
```

## 10.2 与前端一起运行

窗口一：

```powershell
npm run dev:api
```

窗口二：

```powershell
npm run dev
```

或者使用：

```powershell
npm run dev:full
```

## 10.3 常用检查

```powershell
node --check server/index.js
node --check server/app.js
node --check server/database.js
node --check server/security.js
npm test
npm run build
```

`npm run build` 是 Web 前端构建，但属于仓库交付门槛；后端改动也不能破坏前端集成。

## 10.4 测试方式

测试使用 Node.js 原生测试：

```powershell
npm test
```

后端测试通常创建 HTTP server + 内存数据库：

```js
const db = openDatabase(':memory:');
const app = createApp({ db });
const server = createServer(app.handler);
```

高质量后端测试至少包含：

- 成功路径
- 未登录 401
- 无权限 403
- 资源不存在 404
- 参数错误 400
- 过大上传/导入 413
- 非法 MIME 415
- 限流 429（如适用）
- 跨用户访问拒绝
- 跨租户访问拒绝
- 敏感字段不泄漏
- 数据库约束和事务回滚
- 重复请求/幂等行为
- 真实菜单和供应状态约束

## 10.5 端到端手动验证

### 认证和权限

1. 学生登录，获取 Token。
2. 学生访问自己的健康档案、评价、订单。
3. 学生访问管理接口，确认 403。
4. 管理员访问管理接口，确认成功。
5. 使用错误/过期 Token，确认 401。

### 菜单和订单

1. 管理员创建或发布菜单。
2. 设置供应量和售罄。
3. 学生读取今日菜单。
4. 学生创建订单。
5. 确认价格由数据库计算。
6. 确认库存变化、支付状态和取餐码。
7. 重复支付/取消/库存不足场景符合预期。

### AI/RAG/Agent

1. 无 AI Key 时，确定性 fallback 可用或返回安全错误。
2. AI 配置响应不含原始 Key。
3. RAG 引用 ID 对应真实菜品/文档。
4. 过敏和忌口不会被模型建议绕过。
5. 高风险工具不会无确认执行。
6. Agent 工具调用有角色、租户和审计约束。

---

# 十一、OpenAPI、环境变量和部署

## 11.1 OpenAPI

修改 API 时同步更新：

```text
openapi/smart-canteen.yaml
server/app.js
相关测试
README/接口说明（如有变化）
```

至少描述请求参数、响应结构、错误状态、认证方式和权限前提。

## 11.2 环境变量

先看 `.env.example`，常见配置包括：

- `PORT`、`HOST`
- `SMART_CANTEEN_DB`
- `SMART_CANTEEN_SECRET`
- `AI_API_KEY`、`OPENAI_API_KEY`
- `AI_BASE_URL`、模型名和超时
- `REDIS_URL`
- `UPLOAD_DIR`
- `S3_BUCKET`、`S3_ENDPOINT`、访问凭据
- 微信小程序登录配置
- PostgreSQL 数据库连接

不要提交 `.env`。新增环境变量必须：

1. 更新 `.env.example`。
2. 更新 OpenAPI/README 或部署说明。
3. 给出默认值或缺失时的安全行为。
4. 增加配置校验测试。

## 11.3 生产部署边界

生产环境使用 Ubuntu + PM2 + Nginx；可能使用 PostgreSQL、Redis、MinIO/S3。普通后端开发者不要直接修改生产服务器或重启 PM2，除非负责人明确授权并有回滚方案。

发布前确认：

- 构建和测试通过
- migration 已审查
- 生产 secret 已配置且不是默认值
- 数据库备份和回滚方案已确认
- 上传、Redis、PostgreSQL/MinIO 健康检查通过
- Nginx/API 环境变量没有指向本地地址
- 日志不含密钥、密码、Token 和个人敏感信息

---

# 十二、后端提交前清单

```text
## API
- [ ] 请求参数有校验
- [ ] 未登录返回 401
- [ ] 无权限返回 403
- [ ] 资源归属和 tenant scope 已验证
- [ ] 错误不泄漏 SQL、堆栈和敏感信息
- [ ] requestId/X-Request-Id 行为保持一致
- [ ] OpenAPI 已同步

## 数据库
- [ ] 新 schema 使用新 migration
- [ ] SQLite/生产数据库路径已考虑
- [ ] 外键、约束、索引和默认值合理
- [ ] 事务、库存、支付和幂等已验证
- [ ] 没有提交本地数据库和上传文件

## 安全
- [ ] 没有提交 .env、API Key、Token 或密码
- [ ] AI Key 不会出现在响应、日志和审计 payload
- [ ] 上传类型、大小和路径已校验
- [ ] 跨用户和跨租户拒绝测试已覆盖
- [ ] 高风险 Agent 工具需要确认

## 测试
- [ ] node --check 通过
- [ ] npm test 通过
- [ ] npm run build 通过
- [ ] 本次新增/修改接口手动验证
- [ ] 失败路径和边界值已测试

## Git/PR
- [ ] 当前不是 main
- [ ] 已同步最新 main
- [ ] git diff --check 通过
- [ ] 只提交本任务文件
- [ ] 提交信息符合约定
- [ ] PR 说明 API、数据库、安全、部署影响
```

---

# 十三、常见问题

## Q1：后端改代码没有生效

后端默认不自动重启。按 `Ctrl+C` 停止，再运行：

```powershell
npm run dev:api
```

## Q2：端口 8787 被占用

先停止其他 API 进程或使用其他端口：

```powershell
$env:PORT=8788
npm run dev:api
```

同时确认前端代理配置是否需要调整。不要直接杀掉不确定的系统进程。

## Q3：测试偶发失败

确认测试使用内存数据库，且没有测试依赖外部 API、Redis、S3 或个人本地数据。先单独运行失败测试，再运行完整 `npm test`。

## Q4：migration 已经执行但需要修改

不要修改已执行的 SQL 文件。新增更高编号 migration，或先和负责人确认开发数据库可重建。

## Q5：需要查询数据库调试

优先使用测试中的内存数据库或明确的本地开发库。不要把生产连接串、生产数据或个人信息复制到聊天、Issue 或 Claude Code 上下文中。

## Q6：Claude Code 建议直接改前端或后端合同

停止并重新限定范围。接口变化必须先说明请求、响应、权限、迁移、OpenAPI 和兼容影响，不能凭模型猜测。

## Q7：AI 调用失败

先检查：

1. 是否配置 API Key。
2. base URL 和模型是否正确。
3. 超时和响应格式是否符合 provider。
4. 是否触发租户 AI 配额。
5. 是否应该走确定性 fallback。
6. 日志是否泄漏敏感信息。

不要为了让测试通过硬编码成功响应。

---

# 十四、第一次后端任务建议

第一次不要直接重写 `server/app.js` 或数据库。推荐：

1. 克隆项目、安装依赖。
2. 启动 API 并访问 `/api/health`。
3. 阅读一个已有 GET 接口和对应测试。
4. 新增一个小的校验或错误分支。
5. 为它补成功和拒绝测试。
6. 运行 `node --check`、`npm test`、`npm run build`。
7. 用 Claude Code Review 当前 diff。
8. 提交小 PR，并让队友 Review。

完整闭环：

```text
拉代码 → 建分支 → 读路由/鉴权/数据库
→ 明确 API 合同 → Claude Code 修改
→ 补测试 → node --check → npm test
→ 手动请求 → 查看 diff → commit → push
→ PR → Review → 合并 → 同步 main
```

# 十五、后端协作最终原则

1. 先读调用链，再改单个模块。
2. API、数据库、OpenAPI 和测试必须同步。
3. 后端是权限、租户、价格、库存和健康安全的最终边界。
4. 任何客户端字段都不可信，服务端重新读取和计算关键数据。
5. 迁移只增不改，历史数据和订单引用不能被破坏。
6. 测试拒绝路径、边界值、越权和敏感信息泄漏。
7. RAG 解释真实事实，Agent 工具必须受权限和确认控制。
8. Claude Code 负责辅助阅读、实施和检查，不负责替你决定安全边界。
9. 不提交密钥、生产数据、数据库、上传文件或本机配置。
10. 不确定时先保护数据和工作区，再找队友共同决定。
