# 智慧食堂前端团队协作与 Claude Code 开发指南

> 面向：第一次参与本项目、第一次使用 Claude Code 的两位前端开发者  
> 项目：智慧食堂 Smart Canteen  
> 目标：两个人可以在各自电脑上安全拉取代码、独立开发、使用 Claude Code 修改前端、运行项目、提交 Git、互相 Review，并最终合并到 `main`。

---

# 一、先理解这个项目

## 1.1 项目一句话说明

智慧食堂是一个校园餐饮全栈项目：学生可以查找食堂和菜品、查看今日供应、获得健康推荐、咨询智能顾问、识餐和点餐；管理员可以维护食堂、档口、菜品、菜单、订单、评价、用户权限和 AI 配置。

你们这次主要负责的是**前端体验和页面实现**，不应随意改动后端接口、数据库结构、推荐算法或 Agent/RAG 逻辑。

## 1.2 项目当前技术栈

| 部分 | 技术 |
|---|---|
| Web 前端 | Vue 3 + Vite + Vue Router + Pinia |
| 小程序前端 | uni-app + Vue 3 + Vite |
| 后端 | Node.js ESM、原生 HTTP API |
| 数据库 | 本地 SQLite；生产可迁移 PostgreSQL |
| AI | OpenAI-compatible API，可选 |
| RAG | 词法检索 + 向量检索 + 混合检索 |
| 测试 | Node.js `node:test` |
| Web 开发端口 | `5173` |
| API 开发端口 | `8787` |

## 1.3 当前产品能力

### 学生端

- 登录、注册、演示账号
- 学生首页和今日菜单
- 食堂导航、档口和菜品检索
- 菜品价格、口味、标签、评分、营养信息
- 排行榜
- 健康档案和个性化推荐
- 一日或多日健康餐单
- 拍照识餐
- RAG 智能顾问
- 订单、模拟支付、取餐码和订单状态
- 菜品评价

### 管理端

- 食堂和档口管理
- 菜品新增、编辑、归档
- 菜品 JSON/CSV/Excel 导入
- 菜品图片和视觉预填
- 菜单发布、供应量、售罄状态
- 评价审核
- 用户角色管理
- AI 配置
- 智能体实验室
- 订单准备和营业分析
- 审计日志

### 重要产品约束

1. 推荐必须优先来自真实数据库菜品，不能在前端编造菜名、价格或营养数据。
2. 今日已发布且未售罄的菜单优先；没有今日菜单时才允许使用菜品库兜底，并显示来源。
3. 过敏原、明确忌口、清真等属于硬约束，不能被“推荐分数”覆盖。
4. 拍照识餐是辅助估算/匹配，不是医学结论，也不应直接覆盖真实菜品数据。
5. 健康建议不替代医生、营养师或学校管理要求。
6. 评价需要审核，不能在学生提交后直接当成已通过评价展示。
7. 下单属于高风险动作，必须由用户确认。
8. 前端只负责展示和交互；权限、数据归属、健康规则和安全校验必须由服务端最终决定。

## 1.4 Web 前端目录

```text
src/
├── App.vue                    登录页、全局布局、主导航、角色导航
├── main.js                   Web 入口
├── router/index.js           路由和学生/管理员访问控制
├── views/                    页面级组件
│   ├── HomeView.vue          学生首页
│   ├── CanteensView.vue      食堂导航
│   ├── DishesView.vue        菜品检索和详情
│   ├── RankingsView.vue      排行榜
│   ├── RecommendView.vue     健康推荐和餐单
│   ├── VisualMealView.vue    拍照识餐
│   ├── OrdersView.vue        学生订单
│   ├── AdminView.vue         管理端多个面板
│   ├── StallConsoleView.vue  档口订单准备
│   ├── OrderAnalyticsView.vue 管理端订单分析
│   └── AgentView.vue         智能体实验室
├── stores/
│   └── canteenStore.js       Pinia 全局状态、加载和动作
├── services/
│   └── apiClient.js          所有前端 API 请求
├── domain/
│   ├── recommendation.js     推荐、排序、餐单领域逻辑
│   ├── validation.js         表单校验
│   └── seedData.js           演示数据
└── styles/
    └── main.css              全局样式、组件样式和响应式规则
```

## 1.5 小程序前端目录

```text
miniapp/
├── package.json
├── src/
│   ├── pages/                小程序页面
│   ├── components/           可复用组件
│   ├── stores/               小程序状态
│   ├── services/             小程序 API 客户端
│   ├── domain/               可复用领域逻辑
│   ├── styles/               小程序全局样式
│   └── static/               图标和图片
└── docs/                     小程序运行说明
```

**默认约定：**如果任务只说“前端页面”，先确认是 Web `src/` 还是小程序 `miniapp/src/`。不要默认同时修改两套前端。

---

# 二、两个人怎么分工

## 2.1 推荐分工

| 角色 | 主要负责 | 推荐分支前缀 |
|---|---|---|
| 队友 A | 学生端 Web 页面、健康推荐、菜品、首页、交互体验 | `feature/student-...` |
| 队友 B | 管理端 Web 页面、订单后台、数据录入、运营页面 | `feature/admin-...` |

如果实际分工不同，以任务单为准；不要因为“自己方便”同时改对方负责的页面。

## 2.2 可以独立开发的文件

### 队友 A 常见范围

- `src/views/HomeView.vue`
- `src/views/CanteensView.vue`
- `src/views/DishesView.vue`
- `src/views/RankingsView.vue`
- `src/views/RecommendView.vue`
- `src/views/VisualMealView.vue`
- 相关学生端组件和页面样式

### 队友 B 常见范围

- `src/views/AdminView.vue`
- `src/views/StallConsoleView.vue`
- `src/views/OrderAnalyticsView.vue`
- `src/views/AgentView.vue`
- 管理端相关组件和页面样式

## 2.3 高冲突文件

以下文件两个人都可能需要修改，修改前必须在群里说明：

- `src/App.vue`
- `src/router/index.js`
- `src/stores/canteenStore.js`
- `src/services/apiClient.js`
- `src/styles/main.css`
- `package.json`
- `package-lock.json`
- `openapi/smart-canteen.yaml`
- `README.md`

### 修改高冲突文件的规则

1. 先发消息：`我要修改 src/styles/main.css，范围是推荐页响应式样式，预计 30 分钟。`
2. 尽量只增加局部代码，不重排、不格式化整个文件。
3. 一个文件同一时间只由一个人负责修改。
4. 完成后马上提交并通知对方。
5. 不要把无关格式化、改名和功能混在同一个 PR。

## 2.4 每个任务开始前必须写清楚

在群里或 Issue 中写：

```text
任务：优化学生健康推荐页空状态
负责：队友 A
范围：src/views/RecommendView.vue、src/styles/main.css（只改 .recommend-empty）
不改：server/、src/stores/canteenStore.js
验收：空推荐、接口报错、加载中三种状态都能展示
预计：今天 18:00 前提交 PR
```

---

# 三、第一次配置本地环境

## 3.1 安装必要软件

Windows 建议安装：

1. Node.js 22 或更高版本
2. Git for Windows
3. VS Code（可选，但推荐）
4. Claude Code
5. Chrome 或 Edge

检查安装：

```powershell
node -v
npm -v
git --version
```

Node、npm 和 Git 都能输出版本号才算准备完成。

## 3.2 安装 Claude Code

Windows 可以使用官方 WinGet：

```powershell
winget install Anthropic.ClaudeCode
```

安装后重新打开 PowerShell，检查：

```powershell
claude --version
```

然后在项目目录启动：

```powershell
claude
```

Claude Code 在 Windows 可以使用 PowerShell，不要求必须安装 Git Bash。官方资料：

- Claude Code 文档：https://code.claude.com/docs
- Claude Code GitHub：https://github.com/anthropics/claude-code

## 3.3 配置 Git 身份

每个人只需要在自己的电脑配置一次：

```powershell
git config --global user.name "你的姓名"
git config --global user.email "你的 GitHub 邮箱"
git config --global init.defaultBranch main
```

检查：

```powershell
git config --global --list
```

邮箱应使用自己 GitHub 账号关联的邮箱，避免提交显示为无法识别的用户。

## 3.4 GitHub 权限

仓库地址：

```text
https://github.com/heshuoshuo0512/eat
```

需要仓库管理员将两位队友加入仓库协作者。第一次 `git pull` 或 `git push` 时，如果 GitHub 要求登录，使用 GitHub 推荐的浏览器登录、SSH 或 Personal Access Token；不要把 Token 写进代码、`.env` 或聊天记录。

---

# 四、第一次把代码拉到本地

## 4.1 克隆仓库

在准备放项目的目录执行：

```powershell
git clone https://github.com/heshuoshuo0512/eat.git
cd eat
```

检查当前仓库：

```powershell
git remote -v
git branch -a
git status
```

正常情况：

- 远程地址是 `https://github.com/heshuoshuo0512/eat.git`
- 当前分支是 `main`
- `git status` 显示工作区干净

## 4.2 安装依赖

首次安装推荐：

```powershell
npm ci
```

`npm ci` 会严格按照 `package-lock.json` 安装，适合团队协作。只有在需要新增依赖时才使用：

```powershell
npm install 包名
```

如果修改了依赖，必须同时提交 `package.json` 和 `package-lock.json`，并在 PR 中说明原因。

小程序依赖单独安装：

```powershell
cd miniapp
npm ci
cd ..
```

如果小程序依赖安装失败，不要直接删除 lock 文件；先把完整错误发到群里。

## 4.3 不要提交的本地内容

确认 `.gitignore` 已忽略以下内容；如果没有，先询问负责人，不要直接提交：

- `node_modules/`
- `.env`
- `.env.local`
- 真实 API Key、Token、密码
- `data/*.sqlite`
- `uploads/`
- 构建产物
- IDE 临时文件
- 本机截图和临时调试文件

可以提交：

- `.env.example`
- 公开的示例图片
- 页面代码
- 测试代码
- 必要文档

---

# 五、Git 分支和日常协作流程

## 5.1 分支规则

| 分支 | 用途 | 谁可以直接提交 |
|---|---|---|
| `main` | 可合并、可发布的稳定代码 | 不建议任何人直接提交 |
| `feature/...` | 新功能、页面开发 | 对应开发者 |
| `fix/...` | Bug 修复 | 对应开发者 |
| `docs/...` | 文档和指南 | 对应开发者 |
| `refactor/...` | 纯重构 | 需提前沟通 |

禁止：

- 直接在 `main` 上开发
- 直接强制推送 `main`
- 使用 `git push --force`
- 未经沟通删除别人正在使用的分支
- 把两三个无关任务混在一个分支

## 5.2 每次开始开发前

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/student-recommend-empty
```

如果本地已经有该分支：

```powershell
git switch feature/student-recommend-empty
git fetch origin
git merge origin/main
```

推荐用 `git switch`；如果 Git 版本较旧，也可以使用 `git checkout`。

## 5.3 正常开发循环

```powershell
# 1. 查看状态
git status

# 2. 使用 Claude Code 或编辑器修改代码

# 3. 查看具体修改
git diff

# 4. 运行相关检查
npm run build
npm test

# 5. 只暂存本次任务文件
git add src/views/RecommendView.vue src/styles/main.css

# 6. 检查暂存内容
git diff --staged

# 7. 提交
git commit -m "feat(student): 优化健康推荐空状态"

# 8. 推送当前分支
git push -u origin feature/student-recommend-empty
```

不要习惯性使用 `git add .`。它可能把临时文件、无关修改、环境文件一起提交。优先按文件添加。

## 5.4 提交信息格式

格式：

```text
<type>(<scope>): <简短说明>
```

示例：

```text
feat(student): 增加推荐页筛选状态
fix(admin): 修复订单状态按钮显示
style(web): 调整菜品卡片响应式布局
docs(team): 补充前端协作指南
refactor(store): 拆分推荐状态计算
```

常用类型：

- `feat`：新功能
- `fix`：Bug 修复
- `style`：样式和视觉调整
- `refactor`：不改变行为的重构
- `test`：测试
- `docs`：文档
- `chore`：工具或依赖

一次提交最好只表达一个完整变化。不要提交信息写成“修改了一些东西”。

## 5.5 推送后创建 Pull Request

打开：

```text
https://github.com/heshuoshuo0512/eat/pulls
```

创建 PR 时填写：

```text
标题：feat(student): 优化健康推荐空状态

做了什么：
- 增加加载、空结果、接口错误三种状态
- 保持推荐数据来自服务端
- 增加移动端布局

改了哪些文件：
- src/views/RecommendView.vue
- src/styles/main.css

如何验证：
- npm run build
- npm test
- 手动打开 /#/recommend，测试加载、空结果和报错状态

风险：
- 仅修改前端展示，不修改 API 合同
```

PR 需要至少一位队友 Review。Review 时重点看：

- 是否误改 API 字段
- 是否绕过服务端权限或推荐规则
- 是否有空状态、错误状态和加载状态
- 是否破坏学生端/管理员端角色隔离
- 是否提交了密钥或本地文件
- 是否有明显重复代码和无关改动

## 5.6 合并规则

推荐流程：

1. PR 目标是 `main`。
2. 队友 Review 并提出修改意见。
3. 开发者在原分支继续修改并 push。
4. CI/本地检查通过。
5. Review 通过后由负责人合并。
6. 合并后删除远程功能分支。
7. 两个人都重新同步本地 `main`。

合并后同步：

```powershell
git switch main
git pull --ff-only origin main
git branch -d feature/student-recommend-empty
```

如果远程分支未自动删除：

```powershell
git push origin --delete feature/student-recommend-empty
```

## 5.7 如何避免两个人互相覆盖

### 好的做法

- 队友 A 改学生页面，队友 B 改管理页面。
- 共享文件只做小范围修改，并提前通知。
- 新增组件优先于把所有逻辑塞进一个大页面。
- 一个 PR 尽量不超过一个主题。
- 发现对方刚修改同一文件，先沟通再合并。

### 不好的做法

- 两个人同时大面积重写 `src/styles/main.css`。
- 为了“统一格式”格式化整个仓库。
- 为了一个按钮顺手改 `package-lock.json`、后端和 README。
- 直接复制对方分支的全部文件覆盖当前目录。
- 看到冲突就选择“全部接受当前”或“全部接受传入”，不逐段理解。

---

# 六、Git 冲突怎么处理

## 6.1 先更新自己的分支

在自己的功能分支执行：

```powershell
git fetch origin
git merge origin/main
```

如果出现冲突，Git 会列出冲突文件。查看：

```powershell
git status
```

## 6.2 逐段解决冲突

冲突文件会出现：

```text
<<<<<<< HEAD
你当前分支的内容
=======
main 分支的内容
>>>>>>> origin/main
```

处理步骤：

1. 阅读上下文，判断两边分别做了什么。
2. 保留真正需要的部分，删除冲突标记。
3. 不要盲目全部选当前或全部选传入。
4. 保存后检查文件语法。
5. 运行构建和相关测试。
6. 标记解决并提交。

```powershell
git add 冲突文件路径
git commit -m "merge: 同步 main 并解决前端冲突"
git push origin 你的分支名
```

如果不知道怎么处理，停止操作，把冲突文件和双方意图发到群里。不要使用 `git reset --hard` 清理冲突，因为它可能删除自己的工作。

---

# 七、如何使用 Claude Code 修改前端

## 7.1 正确的启动方式

先进入自己的 Git 分支和项目目录：

```powershell
cd D:\Projects\eat
git status
git switch feature/你的分支
claude
```

确认 Claude Code 当前目录是项目根目录。不要在 `src/views` 里面启动，否则 Claude 可能看不到完整项目结构和根目录配置。

## 7.2 第一次启动先让 Claude 认识项目

不要一打开就说“帮我改漂亮”。先输入：

```text
请先阅读 README.md、CONTRIBUTING.md、package.json、src/App.vue、src/router/index.js、src/stores/canteenStore.js 和 src/services/apiClient.js。
先不要修改文件。
请用中文告诉我：
1. 这个项目的前端结构
2. 当前页面和路由
3. 状态管理和 API 请求方式
4. 我接下来修改某个页面时需要注意的产品约束
```

如果 Claude 没有先阅读而直接修改，输入：

```text
停止修改。先只做代码阅读和方案分析，等我确认后再编辑。
```

## 7.3 给 Claude Code 的任务描述模板

每次任务都要把目标、范围、限制和验收标准写清楚：

```text
我要修改 Web 前端的学生健康推荐页。

目标：
- 增加加载中、无匹配、接口错误三种清晰状态
- 保持现有推荐 API 合同不变
- 推荐菜品必须继续来自服务端真实数据
- 保持当前绿色视觉风格和移动端适配

允许修改：
- src/views/RecommendView.vue
- src/styles/main.css 中与推荐页相关的样式

禁止修改：
- server/
- package-lock.json
- 推荐算法和 API 字段

请按顺序执行：
1. 阅读相关文件和调用关系
2. 先说明准备修改哪些位置
3. 修改代码
4. 运行 npm run build
5. 查看 git diff 并总结改动
不要创建临时文件，不要格式化无关文件。
```

## 7.4 Claude Code 的推荐工作模式

### 第一步：阅读

```text
先定位这个页面的路由、状态来源、API 调用和相关样式，不要修改。
```

### 第二步：方案

```text
根据现有代码提出最小改动方案，列出要改的文件和潜在风险，暂时不要执行。
```

### 第三步：修改

```text
按刚才的方案实施，只修改允许的文件。不要重构无关代码。
```

### 第四步：验证

```text
请运行与本次修改相关的检查：npm run build；如果涉及领域逻辑，再运行对应测试。
```

### 第五步：审查

```text
请查看 git diff，按以下顺序审查：
1. 是否修改了任务范围之外的文件
2. 是否改变了 API 合同
3. 是否有空状态、错误状态和加载状态遗漏
4. 是否有 Vue 模板、响应式状态或事件绑定错误
5. 是否有移动端布局问题
最后给出仍需我手动检查的项目。
```

## 7.5 Claude Code 的权限提示怎么处理

Claude Code 可能请求：

- 读取文件：通常可以允许
- 修改指定代码文件：确认路径和范围后允许
- 运行 `npm run build`、`npm test`：确认命令后允许
- 执行 `git diff`、`git status`：通常可以允许
- `git push`、删除文件、修改历史：必须自己确认，不要让它自动执行
- 访问网络、安装依赖：先确认原因和包名

**绝对不要使用危险权限绕过：**

```text
--dangerously-skip-permissions
```

不要让 Claude Code 自动执行以下操作：

- `git push --force`
- `git reset --hard`
- 删除整个目录
- 删除 `.env` 或数据库
- 修改生产服务器
- 把密钥写入文件

## 7.6 Claude Code 修改后必须自己检查

Claude Code 的总结不是验证。自己执行：

```powershell
git status
git diff --stat
git diff
npm run build
```

如果改了交互，必须手动打开页面测试；如果改了移动端，必须缩小浏览器窗口测试；如果改了接口调用，必须启动 API 测试真实流程。

## 7.7 让 Claude Code 帮忙 Review

在提交前输入：

```text
请只做代码审查，不修改文件。
审查当前 git diff，重点检查 Vue 3 响应式、路由权限、API 字段兼容、空状态、错误处理、移动端布局和是否违反项目产品约束。
按严重程度列出问题：阻塞、重要、建议。
```

审查结果中的问题要自己判断，不能无条件照做。

## 7.8 Claude Code 常见误用

### 误用 1：一句话让它重做整个前端

问题：容易覆盖现有约束、破坏路由和 API。

改为：指定一个页面、一个目标、允许修改的文件和验收条件。

### 误用 2：没有看 diff 就提交

问题：可能提交无关改动、密钥、临时文件。

改为：每次提交前执行 `git diff` 和 `git diff --staged`。

### 误用 3：让 Claude 自己决定 API

问题：前端字段与后端合同不一致。

改为：先阅读 `src/services/apiClient.js` 和后端接口，保持现有接口格式；缺接口时先提需求，不自行编造。

### 误用 4：让 Claude 直接改推荐算法

问题：健康推荐是服务端权威，前端不应复制一套算法。

改为：前端展示服务端返回的 `ranked`、`plan`、`context`、`source`、`menu`。

### 误用 5：为了样式统一格式化全仓库

问题：制造大量冲突，Review 无法聚焦。

改为：只修改任务涉及的 CSS 选择器和组件。

---

# 八、本地运行项目

## 8.1 只看页面：启动 Web

```powershell
npm run dev
```

打开：

```text
http://localhost:5173
```

Vite 会把 `/api` 请求代理到：

```text
http://127.0.0.1:8787
```

所以只启动前端时，页面可以打开，但登录、菜单、推荐等需要 API 的功能可能失败。

## 8.2 前后端一起运行：推荐方式

```powershell
npm run dev:full
```

然后打开：

```text
http://localhost:5173
```

如果 Windows 下 `dev:full` 出现子进程或端口问题，可以开两个 PowerShell 窗口：

窗口一：

```powershell
npm run dev:api
```

窗口二：

```powershell
npm run dev
```

API 健康检查：

```text
http://localhost:8787/api/health
```

## 8.3 演示账号

| 身份 | 用户名 | 密码 |
|---|---|---|
| 学生 | `演示学生` | `student123` |
| 管理员 | `admin` | `admin123` |

只在本地开发使用演示账号。不要把真实账号、真实 Token 或 API Key 提交到仓库。

## 8.4 Web 开发测试路径

### 学生端

1. 登录学生账号。
2. 打开学生首页。
3. 打开食堂导航。
4. 搜索菜品并查看营养信息。
5. 打开健康推荐。
6. 修改预算、目标、餐别、口味和忌口。
7. 验证推荐结果、无结果和错误状态。
8. 打开订单页测试下单、支付、取消。
9. 打开智能顾问和拍照识餐。

### 管理端

1. 退出并登录管理员账号。
2. 打开数据中心和数据录入。
3. 查看食堂、档口、菜品和菜单。
4. 检查评价审核页面。
5. 检查订单准备和营业分析。
6. 检查 AI 配置页面是否不会展示真实密钥。
7. 检查学生账号不能访问管理员路由。

## 8.5 小程序运行

小程序在 `miniapp/` 下，是独立的前端工程。进入目录安装依赖：

```powershell
cd miniapp
npm ci
```

开发构建：

```powershell
npm run dev:mp-weixin
```

生产构建：

```powershell
npm run build:mp-weixin
```

小程序还需要按 `miniapp/docs/` 中的 HBuilderX 和微信开发者工具说明操作。修改小程序前，确认任务明确包含 `miniapp/`；不要把 Web Vue 组件直接复制成小程序代码。

---

# 九、前端改动的边界和规范

## 9.1 可以直接改

- 页面布局和视觉层级
- Vue 模板
- 页面局部响应式状态
- 页面局部 CSS
- 复用组件
- 加载、空结果、错误和成功反馈
- 路由链接和页面交互
- 已存在 API 的调用和展示
- 前端表单校验提示
- 前端页面测试或相关文档

## 9.2 修改前必须沟通

- `src/stores/canteenStore.js`
- `src/services/apiClient.js`
- `src/router/index.js`
- `src/domain/recommendation.js`
- `package.json`
- `package-lock.json`
- Web 与小程序共享逻辑
- API 返回字段或请求字段
- 登录、角色权限和订单流程

## 9.3 不要自行修改

- `server/` 后端逻辑
- 数据库迁移
- AI Key 加密和鉴权逻辑
- 生产部署配置
- 其他人的功能分支
- 真实数据文件

如果前端确实需要后端新增字段，先创建 Issue 或在群里说明：

```text
前端需求：订单卡片需要显示 pickupCode，但当前接口没有返回。
影响页面：src/views/OrdersView.vue
建议接口：GET /api/orders 增加 pickupCode（不改变现有字段）
负责人：后端负责人确认后实施
```

---

# 十、页面开发验收标准

每一个页面或组件至少检查以下内容：

## 功能

- 正常数据可以展示
- 点击、提交、筛选、返回、取消都有效
- 成功后有明确反馈
- 重复点击不会造成重复请求或重复下单

## 状态

- 首次加载状态
- 空数据状态
- 接口错误状态
- 权限不足状态
- 登录失效状态
- 网络超时状态
- 提交中状态
- 成功状态

## 数据

- 不编造数据
- 不把 `0`、`null`、空数组混为同一种状态
- 数字和单位正确
- 价格、营养、供应状态来自 API
- 日期、时间和餐别显示正确

## 角色

- 学生不能看管理员页面
- 管理员页面不误显示学生操作入口
- 不把权限判断只放在前端
- 页面隐藏不等于权限安全

## 视觉

- 桌面端正常
- 窄屏手机宽度正常
- 长菜名不撑破卡片
- 按钮有禁用和加载状态
- 颜色对比度可读
- 键盘可以操作主要表单
- 图片有合理的替代文本

## 代码

- 只改任务范围文件
- 不保留调试 `console.log`
- 不提交死代码和临时注释
- 不重复实现 API 请求
- 不在模板里堆复杂计算
- 复用现有 store、apiClient 和样式模式

---

# 十一、提交前检查清单

复制下面清单到每次 PR 描述中：

```text
## 功能
- [ ] 正常数据已验证
- [ ] 加载状态已验证
- [ ] 空数据状态已验证
- [ ] 错误状态已验证
- [ ] 权限和登录失效场景已验证
- [ ] 移动端已验证

## 代码
- [ ] 只修改了任务范围内的文件
- [ ] 没有提交 .env、Token、API Key、数据库或 node_modules
- [ ] 没有修改未知的后端合同
- [ ] 没有保留调试输出
- [ ] 没有引入无必要的新依赖

## Git
- [ ] 当前不是 main 分支
- [ ] 已同步最新 main
- [ ] 已查看 git diff
- [ ] 提交信息清楚
- [ ] 已 push 当前功能分支

## 验证
- [ ] npm run build
- [ ] npm test（如果环境允许，或至少运行相关测试）
- [ ] 手动测试了本次改动涉及的页面
- [ ] PR 已填写改动、验证和风险
```

## 常用检查命令

```powershell
git status
git diff --check
git diff --stat
npm run build
npm test
```

如果只改了纯页面样式，也至少运行：

```powershell
npm run build
git diff --check
```

如果改了状态、API 调用、路由或订单交互，必须运行 `npm test` 并手动验证流程。

---

# 十二、常见问题

## Q1：`npm ci` 失败怎么办？

先记录完整错误。检查：

```powershell
node -v
npm -v
git status
```

不要先删除 `package-lock.json`。确认网络、Node 版本和当前目录正确后再重试。

## Q2：页面打开但接口全部失败

通常是 API 没启动。检查：

```text
http://localhost:8787/api/health
```

如果打不开，启动：

```powershell
npm run dev:api
```

## Q3：页面修改没有生效

1. 确认 Claude Code 或编辑器修改的是当前项目目录。
2. 查看 `git diff` 是否真的有修改。
3. 刷新浏览器。
4. 重启 Vite。
5. 检查是否打开了正确端口 `5173`。

## Q4：登录后跳回首页

检查：

- API 是否启动
- 登录账号是否正确
- 浏览器是否禁用了 localStorage
- 角色是否有该路由权限
- 浏览器 Network 面板的 `/api/auth/login` 返回

## Q5：两个分支冲突怎么办？

不要直接删除一边。先：

```powershell
git status
git diff
```

逐段理解冲突。如果涉及 `App.vue`、`main.css`、store 或 API 客户端，先找对方共同决定保留方案。

## Q6：Claude Code 说“已完成”，但页面坏了

把它当作建议，不是证明。执行：

```powershell
git diff
npm run build
```

然后手动测试页面。发现问题可以让 Claude Code 修复，但要明确指出实际错误和复现步骤。

## Q7：需要撤销自己的未提交改动

先确认文件确实只包含自己的工作，再执行：

```powershell
git restore path/to/file
```

不要在不确定时执行：

```powershell
git reset --hard
```

## Q8：需要暂时切换任务

```powershell
git status
git stash push -m "暂存：推荐页视觉调整"
```

恢复：

```powershell
git stash list
git stash pop
```

使用 stash 前先确认没有未追踪的重要文件。

---

# 十三、两人每周协作节奏

## 每次开发前

- 看群里的任务和别人正在修改的文件。
- 同步 `main`。
- 创建自己的功能分支。
- 明确页面、接口和验收标准。

## 每天开发中

- 至少提交一次可恢复的进展。
- 大范围改共享文件前通知对方。
- 遇到 API、数据或权限不确定时先沟通，不自行猜测。
- 保持自己的分支可以构建。

## 每次完成后

- 运行构建和相关测试。
- 查看完整 diff。
- 推送分支并创建 PR。
- 通知队友 Review。
- PR 合并后同步本地 `main`。

## Review 时

不要只看“页面是否漂亮”，还要看：

- 真实数据是否正确展示
- 推荐和健康边界是否被破坏
- 错误状态是否完整
- API 是否被重复或错误调用
- 权限是否仍然正确
- 是否影响另一个队友的页面
- 是否产生无关改动

---

# 十四、第一次任务建议

为了熟悉项目，不要第一次就重构整个页面。推荐按以下顺序练习：

1. 拉取仓库并成功启动 Web。
2. 用演示学生账号登录。
3. 找到一个页面的加载状态文本并做一个小的文案优化。
4. 用 Claude Code 先阅读，再修改一个局部组件。
5. 运行 `npm run build`。
6. 查看 `git diff`。
7. 提交到自己的分支并 push。
8. 创建第一个小 PR。
9. Review 通过后再做较大的页面改动。

第一次任务的目标不是“改很多”，而是走通完整闭环：

```text
拉代码 → 建分支 → 阅读项目 → Claude Code 修改
→ 本地运行 → 构建/测试 → 查看 diff
→ 提交 → push → PR → Review → 合并 → 同步 main
```

---

# 十五、给两位前端开发者的最终原则

1. **先理解，再修改。**第一次打开项目先看 README、贡献规范、路由、store 和 API 客户端。
2. **小步开发。**一个分支一个主题，一个提交一个完整变化。
3. **分支隔离。**不要直接在 `main` 上工作。
4. **共享文件先沟通。**尤其是 `App.vue`、`main.css`、store、router 和 apiClient。
5. **Claude Code 是协作工具，不是项目负责人。**它可以读、写、运行和分析，但最终决定和验证由开发者负责。
6. **不凭空造数据。**菜品、价格、营养、订单和供应状态来自真实 API。
7. **不绕过安全规则。**前端隐藏按钮不是权限控制，不能把权限判断移到前端代替服务端。
8. **验证比总结重要。**“Claude 说已完成”不等于构建通过、页面正确。
9. **先保护工作，再解决冲突。**不确定时不要 reset、force push 或删除文件。
10. **把问题说具体。**提供页面、路径、复现步骤、错误信息和预期结果，团队才能快速协作。
