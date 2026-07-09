# 智慧食堂 Enterprise MVP

智慧食堂是一个校园餐饮全栈 MVP：学生端用于食堂导航、菜品检索、健康推荐、排行榜和 RAG 智能顾问；管理员端用于维护食堂、菜品、图片、批量导入、用户角色和审计日志。

## 当前能力

### 学生端

- 登录后进入主应用主页，不再把登录入口隐藏在侧边栏底部。
- 查看食堂、档口、菜品、价格、营养、标签和评分。
- 按关键词、价格、口味、清真筛选菜品。
- 提交菜品评价。
- 配置健康档案并获取规则推荐；推荐会优先使用今日已发布且未售罄菜单，未发布时回退完整菜品库。
- 使用智能顾问：先从真实菜品库 RAG 检索，再返回带引用的用餐建议；成功 AI 调用计入租户月度额度。
- 拍照识餐：上传餐食图片后识别菜品、评估营养，并优先推荐今日可供应菜品或真实库中可购买的替代菜。

### 管理端

- 管理食堂：新增、编辑、删除。
- 管理菜品：新增、编辑、软删除/下架。
- 租户管理：创建/更新租户，控制启停状态、套餐、AI 配额和存储配额。
- 批量导入菜品 JSON 或 UTF-8 CSV；CSV 先预览逐行校验，确认后才写库，不依赖服务端 Excel 解析库。
- 菜单运营：按食堂、日期、餐段发布菜单，维护菜单菜品、供应量和售罄状态；支持日期/餐段/状态筛选分页、批量发布/归档，写入时校验租户归属且事务保存，下架采用归档。
- 图片上传并写入菜品图片地址。
- 数据录入、数据管理、AI 配置分路由呈现，避免后台操作混杂。
- 视觉拍照导入只预填菜品表单，管理员确认后才入库。
- 保存 OpenAI-compatible AI 配置；完整 API Key 仅服务端持久化，前端只显示掩码；AI 配置页展示使用量、成功/失败、延迟和月度剩余额度。
- 用户管理：查看用户，调整学生、录入员、档口管理员、食堂管理员、审计员、财务、租户管理员和平台管理员角色。
- 审计日志：查看管理操作、上传、评论、健康档案更新等记录。

### 后端能力

- Node.js 原生 HTTP API，统一 JSON 响应。
- SQLite 默认持久化；PostgreSQL 迁移通过 `DB_DRIVER=postgres` 和显式 `DB_MIGRATE=1` 启用。
- PBKDF2 密码哈希。
- HMAC JWT 登录态。
- RBAC 权限模型：公开注册只创建学生，上传和 AI 能力均要求登录权限。
- IP 限流、请求体大小限制、安全响应头、`X-Request-Id` 请求追踪。
- 排行榜缓存和写入后失效；内存缓存会清理过期项并限制容量。
- 上传存储适配器：本地 fallback 与 S3/MinIO 均按 `tenant_id/upload-id.ext` 隔离。
- RAG 检索、Agent meal advisor 和拍照识餐分析。
- OpenAPI 合同：`openapi/smart-canteen.yaml`。
- Docker Compose：API、PostgreSQL、Redis、MinIO、Nginx。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3, Vite, Pinia, Vue Router |
| 后端 | Node.js ESM, 原生 HTTP |
| 本地数据库 | SQLite via `node:sqlite` |
| 生产数据库路径 | PostgreSQL migration |
| 缓存路径 | 内存 fallback，Redis 可选 |
| 上传路径 | 本地 uploads fallback，S3/OSS/MinIO 可选 |
| 部署 | Dockerfile, docker-compose.yml, Nginx |
| 测试 | node:test |

## 目录结构

```text
server/                  后端 API、数据库、安全、RBAC、缓存、上传、RAG
src/                     Vue 前端和可复用领域逻辑
src/domain/              推荐、排序、种子数据；不依赖浏览器
src/views/               页面：主页、食堂、菜品、排行榜、推荐、Agent、管理端
src/services/apiClient.js 前端 API 客户端
src/stores/canteenStore.js Pinia 状态和业务动作
server/migrations/        PostgreSQL 显式迁移
openapi/                 OpenAPI 合同
nginx/                   Nginx 生产代理配置
tests/                   API、企业 API、E2E/集成测试
uploads/                 本地上传文件目录
data/                    SQLite 数据目录
.env.example              生产/私有化部署环境变量模板
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动前端

```bash
npm run dev
```

### 启动 API

```bash
npm run dev:api
```

### 同时启动前端和 API

```bash
npm run dev:full
```

默认 API 端口：`8787`。

## 默认账号

| 身份 | 用户名 | 密码 |
| --- | --- | --- |
| 学生 | `演示学生` | `student123` |
| 管理员 | `admin` | `admin123` |

登录页提供“学生端 / 管理员端”切换和演示账号按钮。

## 常用命令

```bash
npm test
npm run build
node --test tests/e2e.test.mjs
node --test tests/enterprise-api.test.mjs
```

CI 使用 `.github/workflows/ci.yml` 作为合并门禁：`npm ci`、服务端语法检查、`npm test`、`npm run build`、`docker compose config --quiet` 和 `docker build` 必须全部通过。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | API 监听地址 |
| `PORT` | `8787` | API 端口 |
| `SMART_CANTEEN_SECRET` | 进程内随机值 | JWT HMAC 密钥；未显式配置时重启会使旧 token 失效，生产必须配置稳定高强度密钥。 |
| `SMART_CANTEEN_DB` | `data/smart-canteen.sqlite` | SQLite 文件路径 |
| `UPLOAD_DIR` | `uploads` | 本地上传目录 |
| `PUBLIC_UPLOAD_BASE_URL` | `/uploads` | 上传文件公开 URL 前缀 |
| `DATABASE_URL` | 无 | PostgreSQL 连接串，Docker Compose 已预留 |
| `REDIS_URL` | 无 | Redis 连接串，Docker Compose 已预留 |
| `DB_DRIVER` | 空 | 设为 `postgres` 时使用 PostgreSQL；空值使用 SQLite。 |
| `DB_MIGRATE` | 空 | 仅为 `1` 或 `true` 时运行 PostgreSQL migration；避免生产启动时无意改库。 |
| `AI_API_KEY` / `OPENAI_API_KEY` | 无 | 可选：启动时默认 AI key；管理员端保存的配置优先于环境变量。 |
| `S3_BUCKET` | 无 | 设置后启用 S3/MinIO 上传适配器；未设置时使用本地上传目录。 |
| `S3_REGION` | `us-east-1` | S3/MinIO region。 |
| `S3_ENDPOINT` | 无 | MinIO/兼容对象存储 endpoint。 |
| `S3_ACCESS_KEY_ID` | 无 | S3/MinIO access key。 |
| `S3_SECRET_ACCESS_KEY` | 无 | S3/MinIO secret key。 |
| `S3_PUBLIC_URL` | 自动推导 | 对外访问上传文件的 URL 前缀。 |

| `AI_BASE_URL` / `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 可选：兼容 OpenAI API 的服务地址，例如 DeepSeek/通义/OneAPI/NewAPI/硅基流动网关。 |
| `AI_EMBEDDING_MODEL` / `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | 可选：启动时默认 embedding 模型；管理员端可覆盖。 |
| `AI_CHAT_MODEL` / `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | 可选：启动时默认智能顾问回答模型；管理员端可覆盖。 |
| `AI_VISION_MODEL` / `OPENAI_VISION_MODEL` | `gpt-4o-mini` | 可选：启动时默认视觉识餐模型；管理员端可覆盖。 |
| `AI_TIMEOUT_MS` | `12000` | 可选：AI 请求超时；失败时自动回退确定性本地逻辑。 |
| `WECHAT_MINIAPP_APPID` | 无 | 可选：微信小程序 AppID，启用 `/api/auth/wechat-login` 时必填。 |
| `WECHAT_MINIAPP_SECRET` | 无 | 可选：微信小程序 AppSecret，服务端用于 `code2Session`，严禁下发到前端。 |
| `WECHAT_LOGIN_TIMEOUT_MS` | `8000` | 可选：微信 `code2Session` 请求超时。 |

上传存储策略：未配置 `S3_BUCKET` 时写入本地 `UPLOAD_DIR`；配置 `S3_BUCKET` 且安装 S3 client 后写入 S3/MinIO。两种模式的 `storageKey` 都固定为 `tenant_id/upload-uuid.ext`，tenant id 会先做安全字符清洗，避免跨租户路径穿越。接口响应包含 `provider`、`storageKey`、`url`、`sizeBytes` 和 `contentType`。生产建议 bucket 私有化，后续接入 signed URL；当前 `S3_PUBLIC_URL` 用于公开访问前缀。

管理员端保存的 AI API Key 会按租户写入服务端配置，并使用 `SMART_CANTEEN_SECRET` 派生密钥加密；更换 secret 后旧密文无法解密，生产必须先迁移/重存密钥。

AI 月额度以“成功 AI 调用次数”为单位统计，按租户和自然月计算。`aiQuota=0` 表示不限量；额度耗尽时 Agent、学生拍照识餐和管理员视觉导入返回 `429`。

## 核心 API

### 公共接口

公开注册会忽略请求体中的 `role` 字段并始终创建 `student`；登录未知用户名不会自动注册，连续失败会临时锁定；管理员只能由已有管理员在用户管理中授权。

- `GET /api/health`
- `GET /api/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/wechat-login`
- `GET /api/canteens`
- `GET /api/stalls`
- `GET /api/dishes`
- `GET /api/dishes/:id`
- `GET /api/rankings`
- `GET /api/recommend`
- `GET /api/rag/search?q=鸡胸肉`
- `POST /api/agent/meal-advisor`
- `GET /api/menus/today?mealType=lunch&date=2026-07-05`

### 登录用户接口

- `POST /api/reviews`
- `PUT /api/health/profile`
- `POST /api/uploads`
- `POST /api/vision/meal-analyze`

上传接口要求登录且只接受图片内容类型；返回记录会绑定 `owner_id` 供审计追踪，并返回 `provider`、`storageKey`、`url`、`sizeBytes`、`contentType`。`storageKey` 使用 `tenant_id/upload-uuid.ext` 规则，本地和 S3/MinIO 模式一致。拍照识餐要求登录，并只返回数据库真实菜品的匹配或替代推荐。

所有核心数据已预留 `tenant_id` 并按登录用户租户隔离；匿名请求使用默认租户。

### 管理员接口

- `POST /api/admin/canteens`
- `PUT /api/admin/canteens/:id`
- `DELETE /api/admin/canteens/:id`
- `POST /api/admin/dishes`
- `PUT /api/admin/dishes/:id`
- `DELETE /api/admin/dishes/:id`
- `POST /api/admin/dishes/import`
- `POST /api/admin/dishes/vision-import`
- `GET /api/admin/users`
- `GET /api/admin/tenants`
- `POST /api/admin/tenants`
- `PUT /api/admin/tenants/:id`
- `GET /api/admin/menus`
- `POST /api/admin/menus`
- `PUT /api/admin/menus/:id`
- `DELETE /api/admin/menus/:id`
- `POST /api/admin/menus/batch`
- `PUT /api/admin/users/:id`
- `GET /api/admin/audit-logs?limit=20&offset=0`
- `GET /api/admin/ai-settings`
- `PUT /api/admin/ai-settings`
- `DELETE /api/admin/ai-settings`
- `POST /api/admin/ai-settings/test`
- `GET /api/admin/ai-usage?limit=50&offset=0`


`POST /api/admin/dishes/import/preview` 和 `/confirm` 接收 `{ csvText }`。CSV 第一行是表头，支持 `菜品ID/id`、`档口ID/stallId`、`菜名/name`、`价格/price`、`口味/taste`、`菜系/cuisine`、`食材/ingredients`、`标签/tags`、`热量/calories`、`蛋白/protein`、`脂肪/fat`、`碳水/carbs`、`清真/halal`、`餐别/mealTypes`、`图片地址/imageUrl`、`描述/description`；含逗号字段需用双引号。单次最多 1000 行，确认导入遇到校验错误返回 `400`。

`GET /api/admin/menus` 支持 `date`、`mealType`、`status`、`limit`、`offset`；响应包含 `{ menus, total }`。`POST /api/admin/menus/batch` 使用 `{ action: "publish" | "archive", ids: [...] }` 批量发布或归档。菜单写入会事务化校验食堂和菜品归属，跨租户或不存在的资源返回 `400`。

`GET /api/menus/today` 返回 `{ date, mealType, menus, dishes, source }`；`source=menu` 表示来自今日已发布未售罄菜单，`source=fallback` 表示回退菜品库。`GET /api/recommend` 同步返回 `source` 和 `menu` 元数据。

`GET /api/admin/ai-usage` 返回 AI 调用日志、分组汇总和 `quota: { quota, used, remaining, period }`。当 `remaining=0` 且 `quota>0` 时，AI 调用端点返回 `429`。
## RBAC 权限

| 角色 | 主要能力 |
| --- | --- |
| `student` | 评价、健康档案、上传、智能顾问/拍照识餐。 |
| `operator` | 学生能力 + 菜品录入 + 批量导入。 |
| `stall_admin` | operator + 菜品下架。 |
| `canteen_admin` | stall_admin + 食堂维护 + 审计/用户只读。 |
| `auditor` | 审计和用户只读。 |
| `finance` | 审计只读。 |
| `tenant_admin` | canteen_admin + 食堂删除 + 用户授权 + AI 配置。 |
| `admin` | 平台级兼容管理员，包含租户管理。 |
| `super_admin` | 平台级最高权限；后端已支持，公开用户授权列表暂不开放直接分配。 |

前端导航按角色显示数据录入、数据管理、AI 配置；后端仍以 RBAC 权限为最终边界。AI 配置使用专用 `ai:configure` 权限，租户管理使用 `tenant:manage`。
## RAG 和 Agent 设计

当前实现是“真实菜品库 RAG + 规则推荐 + 可选真实 AI”：

1. 从数据库真实菜品构建文档。
2. 管理员端“智能顾问 API 配置”可保存 OpenAI-compatible `baseUrl`、API Key、embedding/chat/vision 模型和超时；完整 API Key 只保存在服务端，前端只看到掩码。
3. 有管理员配置或环境变量 key 时，调用 OpenAI-compatible embedding；否则使用本地确定性 embedding/词法检索，保证离线可测。
4. 返回检索引用 `citations`。
5. 用健康档案和问题意图调用 `buildMealPlan()` 做可解释规则推荐。
6. 有可用 AI key 时，LLM 只基于 `citations` 和规则推荐生成自然语言建议；没有 key 或调用失败时，回退模板回答。
7. 拍照识餐使用视觉模型做图片识别，但结果会再和数据库真实菜品匹配；未匹配时按健康档案给出真实菜品替代推荐。

约束：Agent 不允许编造数据库不存在的菜。LLM prompt 明确要求只能基于检索引用和推荐 picks 回答；拍照识餐的推荐列表也只来自数据库真实菜品，AI 失败时不会阻断非 AI 业务。

生产升级路径：

- PostgreSQL `pgvector` 存储 embedding。
- 异步生成/刷新 `rag_documents.embedding`。
- 检索阶段先向量召回，再用规则推荐过滤。
- LLM 只做自然语言总结，不参与菜品事实生成。

## Docker 部署

```bash
cp .env.example .env
# 编辑 .env：至少替换 SMART_CANTEEN_SECRET、PostgreSQL 密码、MinIO 密钥。
npm run build
docker compose up --build
```

服务：

- API：`smart-canteen-api`，端口 `8787`，健康检查 `/api/health`。
- PostgreSQL：`smart-canteen-postgres`，默认由 `DB_DRIVER=postgres` 使用。
- Redis：`smart-canteen-redis`，作为缓存后端；不可用时服务端仍可回退内存缓存。
- MinIO：`smart-canteen-minio`，端口 `9000`，控制台 `9001`；设置 `S3_BUCKET` 后上传走 S3/MinIO 适配器，key 规则为 `tenant_id/upload-uuid.ext`。
- Nginx：`smart-canteen-nginx`，端口 `8080`，代理 `/api/` 并提供前端静态资源。

生产迁移不会默认静默执行；只有 `DB_MIGRATE=1` 或 `DB_MIGRATE=true` 时 API 启动会运行 `server/migrations/*.sql`。首次部署建议开启，后续升级应在维护窗口显式执行并保留数据库备份。

上传路径始终带租户前缀；本地卷和 S3/MinIO key 形如 `tenant-id/upload-uuid.ext`。

## 测试覆盖

已有测试覆盖：

- 推荐算法。
- API 登录、RBAC、CRUD、错误处理。
- 企业 API：管理员编辑/删除/导入、上传、RAG、Agent、排行榜失效。
- E2E/集成流程：学生完整链路、管理员完整链路、审计、上传、RAG grounded 行为。
- 前端生产表单校验：登录、评价、健康档案、RAG 查询、管理员菜品/食堂和图片上传。
- 拍照识餐：图片识别结果的营养评估、菜品匹配、真实菜品兜底推荐。
- 部署和文档合同：Docker Compose、环境变量、OpenAPI/README 新增接口、请求追踪、CI workflow。

## CI/CD 门禁

GitHub Actions workflow：`.github/workflows/ci.yml`。

门禁步骤：

1. `npm ci` 安装锁定依赖。
2. `node --check` 检查服务端入口和基础模块。
3. `npm test` 跑全量 `node:test` 套件。
4. `npm run build` 验证前端生产构建。
5. `docker compose config --quiet` 校验 Compose 配置。
6. `docker build -t smart-canteen-ci .` 验证容器镜像可构建。

CI 会清空 `AI_API_KEY` 和 `OPENAI_API_KEY`，保证测试使用确定性本地 fallback；`SMART_CANTEEN_SECRET` 在 CI 中固定为测试密钥。

## 生产注意事项

上线前必须：

- 配置稳定高强度 `SMART_CANTEEN_SECRET`；它同时用于 JWT 签名和 AI Key 加密派生，轮换前必须规划旧密文迁移。
- 使用 PostgreSQL 而不是默认 SQLite，并把 `tenant_id` 作为所有业务查询、索引和备份恢复的隔离边界。
- 使用 Redis 或托管缓存。
- 上传切到 MinIO/S3/OSS/COS，并保留登录态、租户和 `owner_id` 审计。
- 使用 HTTPS。
- 加入验证码/设备风控/更强的登录失败锁定策略。
- 配置数据库备份和迁移流程。
- 保持公开注册只能创建学生；管理员授权必须走已登录管理员的用户管理。

## 小程序迁移路径

- 保留 `src/domain` 推荐逻辑。
- 保留 `/api/*` 合同。
- 将 Vue 页面替换成 uni-app/小程序页面。
- 复用状态结构和 API client 思路。
- Agent/RAG、RBAC、数据库、审计不需要重写。
