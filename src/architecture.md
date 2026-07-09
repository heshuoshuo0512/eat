# 智慧食堂企业级 MVP 架构契约

## 当前交付

- Web 前端：Vite + Vue 3 + Pinia + Vue Router，覆盖学生端和管理员端。
- API 后端：Node.js 原生 HTTP 服务，REST 风格接口，统一 JSON 响应和错误处理。
- 真实数据库：SQLite 持久化文件 `data/smart-canteen.sqlite`，包含用户、食堂、档口、菜品、营养、评论、健康档案、审计日志。
- 领域层独立：`src/domain` 只包含排序、推荐、评分规则，不依赖浏览器和 Vue。
- 服务层隔离：前端通过 `src/services/apiClient.js` 调用 `/api/*`，不再用前端本地数据模拟业务。
- 安全基线：PBKDF2 密码哈希、HMAC JWT、RBAC 管理员鉴权、请求体大小限制、IP 级限流、安全响应头、审计日志。

## 后续转小程序路径

1. 保留 `src/domain` 推荐算法和评分算法。
2. 保留 `/api/*` 合同，小程序端只重写页面和请求适配器。
3. Pinia store 的状态结构可继续沿用；uni-app 页面依赖 Store 暴露的动作和状态。
4. SQLite 可平滑替换为 PostgreSQL；表结构已按实体边界拆分。

## 企业级演进方向

- 数据库：生产建议 PostgreSQL，启用连接池、迁移工具、备份恢复、读写分离。
- 高并发：Nginx / CDN 静态资源缓存、API 水平扩容、Redis 热榜缓存、消息队列异步写审计和统计。
- 安全：强密码策略、验证码/设备风控、HTTPS、CSRF 策略、细粒度 RBAC、操作审计检索、密钥轮换。
- 推荐：当前先规则引擎，后接 LLM 生成解释；LLM 不直接产生不存在的菜品。
- 管理端：真实项目应增加批量导入、数据审批、营养数据版本化、回滚和发布流。
