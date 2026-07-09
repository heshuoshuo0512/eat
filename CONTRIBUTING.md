# 团队开发指南

## 环境准备

### 1. 安装 Node.js

下载并安装 Node.js 22+：https://nodejs.org/

验证：

```bash
node -v    # 应该显示 v22.x.x
npm -v     # 应该显示 10.x.x
```

### 2. 克隆仓库

```bash
git clone https://github.com/heshuoshuo0512/eat.git
cd eat
```

### 3. 安装依赖

```bash
npm install
```

### 4. 启动开发

```bash
npm run dev      # 启动前端 http://localhost:5173
npm run dev:api  # 启动后端 http://localhost:8787
```

## 分支规范

| 分支类型 | 命名格式 | 示例 |
|----------|----------|------|
| 主分支 | `main` | `main` |
| 功能分支 | `feature/描述` | `feature/小端首页` |
| 修复分支 | `fix/描述` | `fix/登录bug` |
| 文档分支 | `docs/描述` | `docs/README更新` |

## 开发流程

### 1. 建分支

```bash
git checkout main
git pull origin main
git checkout -b feature/你的分支名
```

### 2. 开发

```bash
npm run dev          # 前端热更新
npm run dev:api      # 后端需要手动重启
```

### 3. 测试

```bash
npm test             # 运行所有测试
```

### 4. 提交

```bash
git add .
git commit -m "feat: 描述你做了什么"
```

提交信息规范：

| 前缀 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | 修复 bug |
| `docs:` | 文档更新 |
| `style:` | 样式调整 |
| `refactor:` | 重构 |
| `test:` | 测试 |
| `chore:` | 构建/工具 |

### 5. 推送

```bash
git push origin feature/你的分支名
```

### 6. 创建 Pull Request

1. 打开 https://github.com/heshuoshuo0512/eat
2. 点 "Pull requests" → "New pull request"
3. 选择你的分支 → main
4. 填写标题和描述
5. 点 "Create pull request"

### 7. 代码审查

- 至少一个人 review 通过后才能合并
- 合并后删除功能分支

## 项目分工建议

| 模块 | 建议分工 |
|------|----------|
| 学生端前端 | 负责学生相关页面 |
| 管理端前端 | 负责管理后台页面 |
| 小程序端 | 负责微信小程序 |
| 后端 API | 负责后端接口 |
| Agent/RAG | 负责智能体功能 |
| 测试 | 负责测试用例 |

## 常见问题

### Q: 前端改了没反应？

A: Vite 热更新一般自动生效。如果没反应，刷新浏览器。

### Q: 后端改了没反应？

A: 后端需要手动重启。按 `Ctrl+C` 停止，重新 `npm run dev:api`。

### Q: 测试失败？

A: 先确认后端没在运行（端口 8787 不能被占用），然后 `npm test`。

### Q: 代码冲突？

A: 

```bash
git checkout main
git pull origin main
git checkout feature/你的分支
git merge main
# 解决冲突后
git add .
git commit -m "merge: 合并 main 分支"
git push origin feature/你的分支
```

## 目录说明

| 目录 | 说明 |
|------|------|
| `server/` | 后端代码 |
| `src/` | Web 前端代码 |
| `src/views/` | 页面组件 |
| `src/stores/` | Pinia 状态管理 |
| `src/services/` | API 客户端 |
| `src/domain/` | 领域逻辑（推荐、排序） |
| `miniapp/` | 微信小程序代码 |
| `tests/` | 测试文件 |
| `data/` | SQLite 数据库文件 |
| `uploads/` | 上传文件目录 |

## API 端点速查

### 公共接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/register` | 注册（只创建学生） |
| GET | `/api/canteens` | 食堂列表 |
| GET | `/api/dishes` | 菜品列表 |
| GET | `/api/rankings` | 排行榜 |
| POST | `/api/agent/meal-advisor` | 智能顾问 |

### 登录用户接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/reviews` | 提交评价 |
| PUT | `/api/health/profile` | 更新健康档案 |
| POST | `/api/agent/run` | 运行智能体 |

### 管理员接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/canteens` | 创建食堂 |
| POST | `/api/admin/dishes` | 创建菜品 |
| POST | `/api/admin/dishes/import` | 批量导入 |
| GET | `/api/admin/users` | 用户列表 |
| PUT | `/api/admin/users/:id` | 修改用户角色 |
| GET | `/api/admin/ai-settings` | AI 配置 |
| PUT | `/api/admin/ai-settings` | 保存 AI 配置 |

## 联系方式

有问题在群里问，或者直接在 GitHub 上提 Issue。
