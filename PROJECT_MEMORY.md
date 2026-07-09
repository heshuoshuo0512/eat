# 智慧食堂项目记忆

## 当前状态
- 项目路径：`D:/Projects/智慧食堂`。
- 用户偏好：中文、直接执行、少废话；常用“做/做吧”表示继续。
- 产品目标：智慧食堂企业级/商业化 MVP，逐步走向可私有化部署、SaaS 化、生产可交付。

## 已完成核心能力
- 学生端：推荐、健康档案、拍照识餐、今日菜单供应。
- 管理端路由分离：
  - `/#/admin/input` 数据录入
  - `/#/admin` 数据管理
  - `/#/admin/ai` AI 配置
- AI/RAG：OpenAI-compatible 可选 provider，缺 key 时确定性 fallback；Agent/RAG 只基于 DB 菜品回答，不幻觉不存在菜品。
- 管理员 AI 设置：服务端保存、AES-256-GCM 加密、前端只返回 masked key。
- 视觉导入：管理员“视觉拍照导入”只预填表单，不自动入库。
- 学生拍照识餐：基于真实 DB 菜品匹配/替代推荐。
- Auth hardening：注册强制 student；未知用户登录不自动注册；失败锁定；上传需 auth。
- RBAC：扩展 student/operator/stall_admin/canteen_admin/auditor/finance/tenant_admin/admin/super_admin 等角色；AI 配置用 `ai:configure`。
- 租户：tenant 基础表、tenant_id 隔离、租户管理 API/UI、禁用租户 API 访问阻断、租户 ID 格式校验。
- 菜单运营：菜单 CRUD、归档删除、事务写入、租户归属校验、筛选分页、批量发布/归档。
- 今日菜单闭环：`GET /api/menus/today`；推荐优先今日已发布未售罄菜单，fallback 到菜品库。
- AI 治理：AI usage logs，成功/失败记录，月度额度；额度耗尽返回 `429`，不产生新 usage log。
- PostgreSQL migration foundation：`server/migrations.js`，`server/migrations/001_enterprise_foundation.sql`；`DB_MIGRATE=1|true` 才执行迁移。
- Docker/部署：Dockerfile、docker-compose、Nginx、PostgreSQL、Redis、MinIO、`.env.example`。
- CI：`.github/workflows/ci.yml`，包括 `npm ci`、`node --check`、`npm test`、`npm run build`、`docker compose config --quiet`、`docker build`。
- OpenAPI/README：已同步最新菜单、AI usage/quota、上传存储、CI 等合同。

## 最近完成：Excel 批量导入菜品
- 新增依赖：`xlsx`。
- 后端：`server/app.js`
  - `POST /api/admin/dishes/import/preview`
  - `POST /api/admin/dishes/import/confirm`
  - 支持 `.xlsx/.xls` base64，第一个 worksheet。
  - 支持中文/英文表头：菜品ID/id、档口ID/stallId、菜名/name、价格/price、口味/taste、菜系/cuisine、食材/ingredients、标签/tags、热量/calories、蛋白/protein、脂肪/fat、碳水/carbs、清真/halal、餐别/mealTypes、图片地址/imageUrl、描述/description。
  - 逐行校验：档口、菜名、口味、菜系、价格、食材、标签、营养字段。
  - 确认导入有错误行时返回 400；成功后写 `EXCEL_IMPORT` 审计。
- 前端：`src/views/AdminView.vue` 数据录入页新增 Excel 导入卡片：上传 → 预览 → 前 20 行校验 → 确认导入。
- API/store：`previewDishImport`、`confirmDishImport`。
- 测试：`tests/enterprise-api.test.mjs` 覆盖预览、错误拒绝、确认导入、学生禁用。
- 验证：`node --test tests/enterprise-api.test.mjs` 31 passed；`node --check server/app.js` 0；Vite build 通过。

## 最近完成：对象存储合同测试和文档
- `server/storage.js` 新增测试 hooks：
  - `setS3ClientForTests`
  - `resetS3ClientForTests`
- 新增 `tests/storage.test.mjs`：
  - 本地上传写 `UPLOAD_DIR`。
  - local/S3 storageKey 都为 `tenant_id/upload-uuid.ext`。
  - tenant id 清洗，防路径穿越。
  - S3_BUCKET 时走 S3 provider，并验证 PutObject 的 Bucket/Key/ContentType/Body。
  - 拒绝非法 content type 和空内容。
- OpenAPI `/uploads` 补齐 `provider`、`storageKey`、`url` 说明。
- README 补齐本地/S3/MinIO 上传策略、key 规则、生产建议 bucket 私有化和未来 signed URL。
- `tests/deployment.test.mjs` 新增上传存储文档合同测试。
- 验证：`node --test tests/storage.test.mjs tests/deployment.test.mjs` 15 passed；`node --check server/storage.js` 0；Vite build 通过。

## 当前阻断
- Docker Desktop Engine 异常：`docker info` 返回 500 Internal Server Error。
- `docker desktop start` 显示 already running；`docker desktop restart` 超时。
- desktop-linux/default context 都失败。
- 本机无 `psql` / `pg_isready`；`127.0.0.1:5432` 为 `ECONNREFUSED`。
- 因此 PostgreSQL runtime smoke 和 MinIO runtime smoke 尚未完成。

## 当前风险
- `npm install xlsx` 后 `npm audit` 报 `1 high severity vulnerability`。
- Excel 导入属于管理端高风险输入面，下一步优先处理依赖安全。

## 建议下一步
1. 依赖安全治理（首选）：
   - 跑 `npm audit --json`。
   - 定位 `xlsx` 漏洞。
   - 判断是否有安全版本或替换库；必要时改 CSV-only 或限制/隔离 Excel 解析。
   - 加文件大小/解析错误测试和 README 安全说明。
2. Docker 修复后：
   - PostgreSQL runtime smoke。
   - MinIO/S3 runtime smoke。
3. 业务增强：运营数据看板第一版。

## 常用验证命令
- 聚焦企业 API：`node --test tests/enterprise-api.test.mjs`
- 存储/部署合同：`node --test tests/storage.test.mjs tests/deployment.test.mjs`
- 全量测试：`node --test tests/*.test.mjs`
- 后端语法：`node --check server/app.js`、`node --check server/storage.js`
- 前端构建：`node node_modules/vite/bin/vite.js build`

## 重要种子数据
- Admin：username `admin`，password `admin123`
- Student：username `演示学生`，password `student123`
- Canteens：`north`、`central`、`south`
- Dishes：`d-chicken-bowl`、`d-beef-noodle`、`d-egg-tomato`
- 避免旧错 ID：`d-beef-noodles`、`d-veggie-set`
