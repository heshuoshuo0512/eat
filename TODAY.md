# Smart Canteen — 2026-07-10 工作记录

## 完成事项
- 29/29 产品重构 todo 全部完成
- 459 项回归测试全部通过
- 生产服务器 101.34.216.33 已上线最新版本（commit `6e3d58c`）

## 本轮修复
- 食堂自引用校验（不能将食堂设为自己的父级）
- 食堂图片字段 image/imageUrl/image_url 四层对齐
- 智能顾问自然语言解析预算/口味（"预算15元" → budgetMax=15）
- 中文局部嵌入强化（bigram 加权，鸡胸肉搜索重回 Top-1）
- 评价强制审核制（student POST→pending，不可绕过）
- rowToReview 新增 userId 字段
- 今日菜单展示全部状态，推荐侧过滤售罄
- /api/recommend 标准化为 { ranked, plan, context, source, menu }
- README 补充菜单/AI配额/上传存储/CI文档合同
- 8 个测试文件合同修复

## 部署方式
- GitHub TLS 从服务器拉取超时，改用 scp 直传 dist+server+src/domain+migrations
- pm2 restart 后验证 /api/health 正常

## 阻塞项
- Docker Desktop 不可用，PostgreSQL/MinIO 运行时测试无法执行
- xlsx npm audit 高危待修复

## 关键合同（不可退化）
- 推荐服务端权威；评价强制审核；视觉仅预填人工确认
- AI key 加密存储；miniapp/ 不修改
