# 智慧食堂 Agent 助手任务分配计划

> 面向刚开始接触本项目 Agent 模块的成员：先用边界清晰、零风险的验收任务熟悉系统，再逐步进入低风险改进，核心逻辑暂不触碰。

---

## 一、总体原则

- **先验收、后改进、再深入**：不熟悉 Agent 的成员不要一开始就改 `server/agent-langchain.js` 或核心 Agent 逻辑。
- **不修改 Agent 核心逻辑，不修改数据库结构**（第一阶段）。
- **核心文件受控**：涉及权限、租户隔离、订单安全、RAG 数据来源、工具调用、高风险动作确认的文件，误改容易造成安全问题或跨用户数据泄露。

---

## 二、第一阶段：Agent 功能验收与评测用例（推荐第一项任务）

### 1. 分支与范围

```bash
git switch main
git pull origin main
git switch -c feat/agent-qa
git push -u origin feat/agent-qa
```

- 分支名：`feat/agent-qa`
- 职责：智慧食堂 Agent 的功能验收与评测用例整理
- 约束：不修改 Agent 核心逻辑，不修改数据库结构

### 2. 执行步骤

1. 本地启动项目，登录学生账号和管理员账号
   - 学生：`student / student123`
   - 管理员：`admin / admin123`
2. 测试接口 `POST /api/agent/assistant`
3. 在 Agent 页面测试以下问题：
   - 今天午餐吃什么？
   - 我想减脂，推荐低热量菜品
   - 我想吃清真餐
   - 我的订单状态是什么？
   - 预算 15 元以内怎么吃？
   - 哪个食堂现在有适合我的菜？
4. 检查回答是否包含以下字段：
   - `answer`
   - `intent`
   - `steps`
   - `toolResults`
   - `citations`
   - `plan`
   - `actions`
5. 检查高风险下单动作是否需要确认
6. 检查学生是否只能看到自己的订单
7. 检查引用是否来自真实菜品或健康知识库
8. 将测试结果记录到文档或测试用例中
9. 提交 Pull Request 到 `main`

### 3. 重点阅读文件

先读这些文件，不要一开始全项目乱看：

```text
src/views/AgentView.vue
server/app.js
server/agent-langchain.js
server/rag.js
tests/agent-assistant.test.mjs
tests/agent-governance.test.mjs
tests/agent-final.test.mjs
docs/RAG-AGENT-ARCHITECTURE.md
```

### 4. 核心接口

```text
POST /api/agent/assistant
GET  /api/agent/evals
GET  /api/agent/memory
GET  /api/agent/actions
POST /api/agent/actions/:id/confirm
POST /api/agent/actions/:id/reject
```

### 5. 验收标准（需提交的交付物）

#### 5.1 测试报告

| 场景         | 结果                 | 是否符合预期 |
| ------------ | -------------------- | ------------ |
| 减脂午餐推荐 | 返回菜品、计划和引用 | 通过         |
| 清真餐推荐   | 过滤非清真菜品       | 通过         |
| 我的订单     | 只返回当前用户订单   | 通过         |
| 预算 15 元   | 推荐价格不超过 15 元 | 通过         |
| 生成订单     | 只生成待确认动作     | 通过         |
| 健康问答     | 返回引用来源         | 通过         |

#### 5.2 发现的问题

每个问题按以下格式记录：

```text
问题：
复现步骤：
实际结果：
预期结果：
严重程度：
相关接口或文件：
```

#### 5.3 测试命令结果

```bash
node --test tests/agent-assistant.test.mjs
node --test tests/agent-governance.test.mjs
node --test tests/agent-final.test.mjs
```

---

## 三、第二阶段：低风险改进（完成验收后）

### 任务 A：改进 Agent 页面提示

- 只修改：`src/views/AgentView.vue`
- **不要修改后端接口**
- 可以做：
  - 增加示例问题
  - 显示当前执行步骤
  - 显示引用来源
  - 显示"需要用户确认"的动作
  - 优化错误提示
  - 增加"清空记忆"说明

### 任务 B：补充 Agent 评测用例

围绕以下边界编写测试：

- 未登录不能使用 Agent
- 学生不能读取其他用户订单
- 普通角色不能查看营业分析
- 下单必须经过确认
- 跨租户数据不能泄露
- AI Key 不能出现在响应中
- 健康回答不能越过医疗边界

### 任务 C：维护 Agent FAQ 文档

整理为 `docs/Agent使用与测试手册.md`，内容包括：

- Agent 能做什么
- Agent 不能做什么
- 可用示例问题
- 如何确认下单
- 如何查看引用
- 常见错误
- 如何反馈问题

---

## 四、暂时不要触碰的文件（核心受控）

```text
server/app.js
server/agent-langchain.js
server/database.js
server/rag.js
server/rbac.js
```

这些文件涉及：

- 权限
- 租户隔离
- 订单安全
- RAG 数据来源
- Agent 工具调用
- 高风险动作确认

> 误改容易造成安全问题或跨用户数据泄露。

---

## 五、结论

**先做 Agent 页面和接口验收、评测用例、问题报告，不要马上改 Agent 核心代码。**

这样成员能熟悉 Agent 的工具、权限、引用和确认机制，同时不会影响主流程。

---

## 六、参考：项目运行与测试

- 启动前端：`npm run dev`
- 启动后端：`npm run dev:api`
- 同时启动：`npm run dev:full`
- 运行全部测试：`npm test`
- 运行指定测试：`node --test tests/<文件名>.test.mjs`

种子数据：

- 管理员：`admin / admin123`
- 学生：`student / student123`
- 食堂：北苑 / 中心 / 南苑

部署环境：Ubuntu 24.04 + PM2 + Nginx；本地 Windows 开发无 Bash，Docker 暂不可用。