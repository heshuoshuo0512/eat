# 发布前工作区变更清单（2026-08-01）

## 注册与邀请码后端
- server/app.js：注册码 `optional` 注册模式；注册码优先跳过短信验证码；新生成邀请码默认3天；邀请码能力与过期判断。
- server/database.js：SQLite 邀请码表、批次、领取、审计索引及3天默认值。
- server/invitationCodes.js、scripts/generate-pilot-invitations.mjs：邀请码哈希与生成工具。
- server/migrations/029_pilot_invitations.sql 至 033_invitation_default_expiry.sql：PostgreSQL 迁移。
- src/views/InvitationManagementView.vue、src/router/index.js、src/services/apiClient.js：Web 管理页面及接口。
- server/rbac.js、src/App.vue：管理入口及统一注册表单。

## Web 与小程序
- src/App.vue、src/domain/validation.js：手机号、可选注册码、短信验证码统一注册。
- miniapp/src/pages/login/login.vue、miniapp/src/domain/validation.js：小程序统一注册表单。
- miniapp/src/components/*、pages/*、services/*、stores/*、config.js、manifest.json、project.private.config.json：本工作区已有小程序 UI、接口和配置改动。

## 目录/RAG及其他已有改动
- server/app.js、server/database.js、server/rbac.js、src/*、miniapp/* 中除注册部分外的现有目录、RAG、权限、页面和接口改动全部纳入本次提交。
- docs/目录人工分区审核指南-2026-07-31.md：人工分区交接文档。
- artifacts/：已有本地验证截图及本报告；不包含数据库、API Key 或邀请码明文。

## 测试与配置
- tests/invitation-management.test.mjs：邀请码批次、领取、撤销、过期、统计、并发与隔离测试。
- tests/student-auth-onboarding.test.mjs：邀请码模式、可选模式、短信模式、消费与重复使用测试。
- tests/miniapp-readiness.test.mjs、package.json、docker-compose.yml、.env.example、.gitignore：构建/部署与忽略规则。

## 已执行验证
- `npm test`：854/854 通过。
- 邀请码专项：10/10 通过。
- 注册专项：9/9 通过。
- `npm run build`：通过。
- `VITE_API_BASE_URL=https://stueat.com npm run build:miniapp`：通过。
- 密钥模式扫描：无匹配；邀请码明文只存在测试 fixture/一次性运行响应，不写入数据库或生产日志。

## 发布前保留
- 不提交 `.env`、数据库文件、构建目录、日志、API Key、SSH 私钥或生产邀请码明文。
- 发布前先备份服务器代码版本和数据库；迁移失败按旧版本和数据库备份回滚。
