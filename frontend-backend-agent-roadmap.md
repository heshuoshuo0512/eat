# 前端、后端与 AI Agent 学习路线

这是一份从基础到高阶的学习路线，适合想系统学习 **前端开发、后端开发、全栈开发、AI Agent 开发** 的初学者。

你可以把整个方向理解成三部分：

- **前端**：用户能看到、能点击、能操作的页面。
- **后端**：用户看不到，但负责数据、登录、权限、业务逻辑的服务。
- **Agent**：能理解目标、调用工具、分步骤完成任务的 AI 程序。

---

## 目录

1. [学习总览](#学习总览)
2. [第一阶段：计算机与编程基础](#第一阶段计算机与编程基础)
3. [第二阶段：前端基础](#第二阶段前端基础)
4. [第三阶段：现代前端](#第三阶段现代前端)
5. [第四阶段：后端基础](#第四阶段后端基础)
6. [第五阶段：数据库与鉴权](#第五阶段数据库与鉴权)
7. [第六阶段：全栈开发](#第六阶段全栈开发)
8. [第七阶段：AI 应用开发](#第七阶段ai-应用开发)
9. [第八阶段：AI Agent 开发](#第八阶段ai-agent-开发)
10. [推荐项目练习](#推荐项目练习)
11. [推荐学习顺序](#推荐学习顺序)
12. [常见误区](#常见误区)
13. [官方学习资源](#官方学习资源)

---

# 学习总览

如果你从零开始，推荐按照下面这条路线学习：

```txt
HTML
  ↓
CSS
  ↓
JavaScript
  ↓
TypeScript
  ↓
React
  ↓
Node.js
  ↓
Express / NestJS
  ↓
数据库 PostgreSQL / MySQL / SQLite
  ↓
登录、权限、接口安全
  ↓
全栈项目
  ↓
Claude API / OpenAI API
  ↓
Tool Use 工具调用
  ↓
RAG 文档问答
  ↓
Memory 记忆系统
  ↓
Agent Loop
  ↓
Multi-Agent 多 Agent 协作
```

一句话总结：

> 先学会做网页，再学会写接口和数据库，然后把前后端连接起来，最后接入大模型，做能自动完成任务的 AI Agent。

---

# 第一阶段：计算机与编程基础

## 1. 电脑与文件基础

你需要先理解这些基础概念：

| 概念 | 解释 |
|---|---|
| 文件 | 代码、图片、配置都以文件形式保存 |
| 文件夹 | 用来组织项目文件 |
| 路径 | 文件在电脑中的位置 |
| 命令行 | 用文字命令操作电脑 |
| 浏览器 | 运行网页的环境 |
| 服务器 | 提供网页、接口、数据的程序或机器 |
| HTTP | 浏览器和服务器通信的协议 |
| URL | 网页地址 |

前端、后端的关系可以这样理解：

```txt
用户浏览器  <----HTTP 请求/响应---->  后端服务器  <----查询/保存---->  数据库
```

---

## 2. 编程基础

建议从 **JavaScript** 开始，因为它可以写前端，也可以通过 Node.js 写后端，还可以开发 AI Agent。

需要掌握：

| 知识 | 解释 |
|---|---|
| 变量 | 用来保存数据 |
| 条件判断 | 根据不同条件执行不同代码 |
| 循环 | 重复执行某段逻辑 |
| 函数 | 把一段逻辑封装起来重复使用 |
| 对象 | 用键值对保存复杂数据 |
| 数组 | 保存一组数据 |
| 异步 | 等待接口、文件、数据库返回结果 |
| Promise | JavaScript 处理异步的机制 |
| async / await | 更容易写异步代码的语法 |
| 模块 | 把代码拆成多个文件 |

示例：

```js
async function getUser() {
  const response = await fetch('/api/user');
  const user = await response.json();
  return user;
}
```

这段代码的意思是：

> 向后端请求用户数据，等待数据返回后，把它转换成 JavaScript 对象。

---

# 第二阶段：前端基础

前端的核心目标是：

> 把数据变成用户能看到、能点击、能操作的页面。

---

## 1. HTML：页面结构

HTML 决定网页上有什么内容。

可以理解为：

> HTML 是网页的骨架。

示例：

```html
<h1>欢迎来到我的网站</h1>
<p>这是一个介绍文字</p>
<button>点击我</button>
```

常见标签：

| 标签 | 作用 |
|---|---|
| `h1` | 一级标题 |
| `p` | 段落 |
| `button` | 按钮 |
| `img` | 图片 |
| `a` | 链接 |
| `input` | 输入框 |
| `form` | 表单 |
| `div` | 通用容器 |
| `span` | 行内容器 |

---

## 2. CSS：页面美化和布局

CSS 决定网页长什么样。

可以理解为：

> CSS 负责页面美化，比如颜色、大小、间距、布局、动画。

示例：

```css
button {
  background: blue;
  color: white;
  border-radius: 8px;
  padding: 10px 16px;
}
```

这段代码表示：

> 把按钮设置成蓝色背景、白色文字、圆角，并增加内边距。

需要掌握：

| 知识 | 解释 |
|---|---|
| 选择器 | 选中页面中的元素 |
| 颜色 | 设置文字或背景颜色 |
| 字体 | 设置字号、粗细、字体 |
| 盒模型 | 控制宽高、边距、边框 |
| Flex | 一维布局，常用于横向或纵向排列 |
| Grid | 二维布局，常用于复杂页面结构 |
| 响应式 | 让页面适配手机、平板、电脑 |
| 动画 | 让元素移动、淡入淡出、过渡 |

常见居中写法：

```css
.container {
  display: flex;
  justify-content: center;
  align-items: center;
}
```

意思是：

> 让容器中的内容水平和垂直居中。

---

## 3. JavaScript：页面交互

JavaScript 让页面动起来。

可以理解为：

> JavaScript 负责用户交互和业务逻辑。

示例：

```js
const button = document.querySelector('button');

button.addEventListener('click', () => {
  alert('你点击了按钮');
});
```

这段代码表示：

> 当用户点击按钮时，弹出提示框。

需要掌握：

| 知识 | 解释 |
|---|---|
| DOM | 浏览器中的页面结构 |
| 事件 | 点击、输入、滚动等用户行为 |
| fetch | 向后端请求数据 |
| localStorage | 浏览器本地存储 |
| 表单处理 | 获取用户输入 |
| 错误处理 | 请求失败时给用户提示 |

---

# 第三阶段：现代前端

## 1. TypeScript

TypeScript 是 JavaScript 的增强版。

可以理解为：

> TypeScript 给 JavaScript 加上类型检查，减少 bug。

JavaScript 写法：

```js
function add(a, b) {
  return a + b;
}
```

TypeScript 写法：

```ts
function add(a: number, b: number): number {
  return a + b;
}
```

这样编辑器可以提前发现类型错误。

需要掌握：

| 知识 | 解释 |
|---|---|
| string | 字符串 |
| number | 数字 |
| boolean | 布尔值 |
| interface | 描述对象结构 |
| type | 定义类型别名 |
| union | 多种可能类型 |
| generics | 泛型，让代码更灵活 |

---

## 2. React

React 是主流前端框架。

可以理解为：

> React 用组件的方式搭建页面。

组件示例：

```tsx
function Button() {
  return <button>点击我</button>;
}
```

带参数的组件：

```tsx
function UserCard({ name }: { name: string }) {
  return <div>用户名：{name}</div>;
}
```

React 重点：

| 知识 | 解释 |
|---|---|
| Component | 组件 |
| Props | 父组件传给子组件的数据 |
| State | 组件自己的状态 |
| useState | 管理状态 |
| useEffect | 处理副作用，比如请求接口 |
| 条件渲染 | 根据条件显示不同内容 |
| 列表渲染 | 渲染数组 |
| Router | 页面路由 |
| 表单处理 | 登录、注册、搜索 |

示例：

```tsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      点击次数：{count}
    </button>
  );
}
```

这段代码表示：

> 每点击一次按钮，数字加 1。

---

## 3. 前端工程化

项目变大后，就需要工程化工具。

需要掌握：

| 工具/概念 | 解释 |
|---|---|
| npm | 安装和管理依赖 |
| pnpm | 更快的包管理工具 |
| Vite | 前端构建工具 |
| ESLint | 检查代码规范 |
| Prettier | 自动格式化代码 |
| Git | 版本管理 |
| GitHub | 代码托管平台 |
| 环境变量 | 区分开发、测试、生产环境配置 |
| 构建 | 把开发代码转换成上线代码 |
| 部署 | 把项目发布到服务器或平台 |

---

## 4. 高级前端

进阶方向：

| 方向 | 内容 |
|---|---|
| 性能优化 | 懒加载、代码分割、缓存 |
| 状态管理 | Zustand、Redux、Jotai |
| 请求管理 | TanStack Query、SWR |
| UI 组件库 | Ant Design、MUI、shadcn/ui |
| 动画 | Framer Motion |
| SSR | 服务端渲染 |
| Next.js | React 全栈框架 |
| 安全 | XSS、CSRF、防注入 |
| 测试 | Vitest、Playwright、Cypress |

---

# 第四阶段：后端基础

后端的核心目标是：

> 处理业务逻辑、数据存储、权限、安全和接口。

---

## 1. Node.js

Node.js 让 JavaScript 可以运行在服务器上。

可以理解为：

> Node.js 是后端 JavaScript 的运行环境。

前端 JavaScript 运行在浏览器中。  
后端 JavaScript 运行在 Node.js 中。

需要掌握：

| 知识 | 解释 |
|---|---|
| 运行 JS 文件 | 使用 `node index.js` |
| npm | 管理依赖 |
| 文件系统 | 读写文件 |
| 环境变量 | 保存配置 |
| 模块系统 | import / export |
| 异步 I/O | 处理文件、网络、数据库操作 |

---

## 2. HTTP 与 API

后端主要通过 API 给前端提供数据。

例如前端请求：

```http
GET /api/users
```

后端返回：

```json
[
  { "id": 1, "name": "张三" },
  { "id": 2, "name": "李四" }
]
```

常见 HTTP 方法：

| 方法 | 作用 |
|---|---|
| GET | 获取数据 |
| POST | 创建数据 |
| PUT | 整体更新数据 |
| PATCH | 部分更新数据 |
| DELETE | 删除数据 |

常见状态码：

| 状态码 | 解释 |
|---|---|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求错误 |
| 401 | 未登录 |
| 403 | 没权限 |
| 404 | 找不到 |
| 500 | 服务器错误 |

---

## 3. Express / NestJS

Express 是轻量级 Node.js 后端框架。

可以理解为：

> Express 用来快速写后端接口。

示例：

```js
import express from 'express';

const app = express();

app.get('/api/hello', (req, res) => {
  res.json({ message: '你好' });
});

app.listen(3000);
```

这段代码表示：

> 启动一个服务器，访问 `/api/hello` 时返回 `{ message: '你好' }`。

NestJS 是更工程化的后端框架。

可以理解为：

> NestJS 更适合中大型项目，结构更规范。

---

# 第五阶段：数据库与鉴权

## 1. 数据库

数据库负责保存数据。

常见数据库：

| 数据库 | 类型 | 适合场景 |
|---|---|---|
| SQLite | 关系型 | 小项目、本地项目 |
| PostgreSQL | 关系型 | 正式项目、复杂业务 |
| MySQL | 关系型 | 常见业务系统 |
| MongoDB | 文档型 | 灵活数据结构 |
| Redis | 内存型 | 缓存、队列、限流 |

关系型数据库可以理解为 Excel 表格。

用户表：

| id | name | email |
|---|---|---|
| 1 | 张三 | zhang@example.com |
| 2 | 李四 | li@example.com |

SQL 示例：

```sql
SELECT * FROM users WHERE id = 1;
```

意思是：

> 从用户表中查出 id 等于 1 的用户。

---

## 2. ORM

ORM 是用代码操作数据库的工具。

可以理解为：

> ORM 把数据库表变成代码对象。

常见 ORM：

| ORM | 说明 |
|---|---|
| Prisma | TypeScript 项目常用 |
| Drizzle | 轻量、类型友好 |
| TypeORM | NestJS 项目常见 |

Prisma 示例：

```ts
const user = await prisma.user.findUnique({
  where: { id: 1 },
});
```

意思是：

> 查询 id 为 1 的用户。

---

## 3. 登录与权限

后端必须处理用户身份。

需要掌握：

| 概念 | 解释 |
|---|---|
| Authentication | 认证，判断你是谁 |
| Authorization | 授权，判断你能做什么 |
| Cookie | 浏览器保存的小数据 |
| Session | 服务端保存登录状态 |
| JWT | Token 形式的登录凭证 |
| OAuth | 第三方登录，如 GitHub 登录 |
| RBAC | 基于角色的权限控制 |

例子：

- 未登录用户不能访问个人中心。
- 普通用户不能删除管理员。
- 管理员可以查看后台数据。

---

## 4. 后端安全

后端安全非常重要。

常见风险：

| 风险 | 解释 |
|---|---|
| SQL 注入 | 用户输入恶意 SQL |
| XSS | 注入恶意脚本 |
| CSRF | 伪造用户请求 |
| 暴力破解 | 不断尝试密码 |
| 权限绕过 | 普通用户访问管理员接口 |
| 敏感信息泄漏 | 把密码、密钥暴露出去 |
| 依赖漏洞 | 使用有安全问题的库 |

基础原则：

- 密码不能明文存储。
- API 要校验权限。
- 用户输入不能直接拼接 SQL。
- 密钥不要写进代码。
- 后端不能相信前端传来的权限信息。

---

# 第六阶段：全栈开发

全栈开发就是前端和后端都能做。

常见项目结构：

```txt
project/
  frontend/   前端 React 页面
  backend/    后端 Express 接口
  database/   数据库脚本或配置
```

前端请求后端：

```ts
const res = await fetch('http://localhost:3000/api/users');
const users = await res.json();
```

后端查询数据库后返回数据。

需要掌握：

| 知识 | 解释 |
|---|---|
| 前后端分离 | 前端和后端独立开发 |
| CORS | 跨域资源共享 |
| Cookie / JWT | 登录状态处理 |
| 数据库设计 | 设计表结构和关系 |
| 文件上传 | 上传头像、图片、文档 |
| 日志 | 记录系统运行情况 |
| 部署 | 把项目上线 |
| Docker | 把应用打包成容器 |
| Nginx | 反向代理、静态资源服务 |

---

## Next.js 全栈

Next.js 是 React 的全栈框架。

可以理解为：

> Next.js 既能写前端页面，也能写后端接口。

它可以做：

| 功能 | 解释 |
|---|---|
| 页面 | React 页面 |
| API Route | 后端接口 |
| SSR | 服务端渲染 |
| SSG | 静态生成 |
| Middleware | 中间件，例如权限判断 |
| 部署 | 很适合部署到 Vercel |

---

# 第七阶段：AI 应用开发

AI 应用开发的目标是：

> 把大模型能力接入自己的产品或工具中。

---

## 1. 大模型基础

需要理解：

| 概念 | 解释 |
|---|---|
| LLM | 大语言模型 |
| Prompt | 给模型的指令 |
| Context | 上下文 |
| Token | 模型处理文本的单位 |
| System Prompt | 系统级指令 |
| User Message | 用户输入 |
| Assistant Message | 模型回复 |
| Temperature | 控制输出随机性 |
| Max Tokens | 最大输出长度 |

---

## 2. Prompt Engineering

Prompt Engineering 是写好模型指令的能力。

不好的 Prompt：

```txt
帮我写代码
```

更好的 Prompt：

```txt
请用 TypeScript 写一个 Express 接口：
1. 路径是 POST /api/login
2. 接收 email 和 password
3. 校验参数不能为空
4. 成功时返回 userId
5. 失败时返回 401
```

原则：

| 原则 | 解释 |
|---|---|
| 明确目标 | 告诉模型要完成什么 |
| 给上下文 | 提供背景信息 |
| 给约束 | 指定语言、框架、格式 |
| 给例子 | 示例能提升效果 |
| 分步骤 | 复杂任务拆开 |
| 要求输出格式 | JSON、Markdown、代码等 |

---

## 3. Claude API / OpenAI API

调用模型 API 的流程：

```txt
你的程序 -> 调用模型 API -> 模型返回结果 -> 你的程序处理结果
```

伪代码：

```ts
const message = await client.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 1000,
  messages: [
    {
      role: 'user',
      content: '帮我总结这段文本',
    },
  ],
});
```

需要掌握：

| 概念 | 解释 |
|---|---|
| API Key | 调用模型的密钥 |
| SDK | 官方开发工具包 |
| Messages API | 对话接口 |
| Streaming | 流式输出 |
| Tool Use | 工具调用 |
| Prompt Caching | 提示词缓存 |
| Batch | 批量处理 |
| Rate Limit | 调用频率限制 |
| Cost | API 成本控制 |

---

# 第八阶段：AI Agent 开发

Agent 是更高级的 AI 应用。

可以理解为：

> Agent 是能理解目标、调用工具、分步骤完成任务的 AI 程序。

普通 AI 对话：

```txt
用户：帮我写一段代码
AI：这是代码
```

Agent：

```txt
用户：帮我修复这个项目的 bug
Agent：
1. 查看文件
2. 运行测试
3. 分析报错
4. 修改代码
5. 再次测试
6. 汇报结果
```

---

## 1. Tool Use 工具调用

工具调用是 Agent 的核心。

普通模型只能回答。  
有工具调用后，模型可以做事。

常见工具：

| 工具 | 作用 |
|---|---|
| searchWeb | 搜索网页 |
| readFile | 读取文件 |
| writeFile | 写文件 |
| runCommand | 执行命令 |
| queryDatabase | 查询数据库 |
| callAPI | 调用外部接口 |
| sendEmail | 发送邮件 |
| createTicket | 创建任务 |

例子：

```txt
用户：帮我查一下测试为什么失败

Agent 可能会：
1. runCommand('npm test')
2. readFile('src/user.ts')
3. writeFile('src/user.ts')
4. runCommand('npm test')
```

---

## 2. Agent Loop

Agent Loop 是 Agent 的工作循环。

常见流程：

```txt
1. 接收目标
2. 判断下一步
3. 选择工具
4. 执行工具
5. 观察结果
6. 决定继续还是结束
```

也可以理解成：

```txt
Think -> Act -> Observe -> Think -> Act -> Observe
```

示例：

```txt
目标：修复登录 bug

观察：测试报错 password is undefined
行动：读取 login.ts
观察：字段名写成 passwrod
行动：修改为 password
观察：测试通过
结束：汇报修复结果
```

---

## 3. RAG：检索增强生成

RAG 的意思是：

> 先搜索资料，再让模型基于资料回答。

适合场景：

- 企业知识库
- 文档问答
- 项目代码问答
- 客服机器人
- 法律、医疗、财务资料问答

基本流程：

```txt
文档
  ↓
切片 Chunking
  ↓
向量化 Embedding
  ↓
存入向量数据库
  ↓
用户提问
  ↓
检索相关片段
  ↓
交给模型回答
```

需要掌握：

| 概念 | 解释 |
|---|---|
| Embedding | 把文本变成向量 |
| Vector Database | 向量数据库 |
| Chunking | 文档切片 |
| Retrieval | 检索 |
| Rerank | 重新排序 |
| Citation | 引用来源 |
| Hallucination | 模型幻觉 |

---

## 4. Memory 记忆系统

Agent 要长期有用，通常需要记忆。

常见记忆类型：

| 类型 | 解释 |
|---|---|
| 短期记忆 | 当前对话上下文 |
| 长期记忆 | 用户偏好、项目背景 |
| 工作记忆 | 当前任务状态 |
| 外部记忆 | 数据库、文件、向量库 |

例子：

```txt
用户喜欢 TypeScript
用户不喜欢太长解释
当前项目使用 PostgreSQL
```

注意：

- 不能乱记隐私。
- 记忆要可删除。
- 重要信息要验证。
- 记忆不能代替权限系统。

---

## 5. Multi-Agent 多 Agent

多个 Agent 可以分工合作。

例如：

| Agent | 负责 |
|---|---|
| Planner | 制定计划 |
| Researcher | 查资料 |
| Coder | 写代码 |
| Tester | 运行测试 |
| Reviewer | 审查代码 |
| Summarizer | 总结结果 |

流程：

```txt
用户提出需求
  ↓
Planner 拆任务
  ↓
Researcher 查资料
  ↓
Coder 写代码
  ↓
Tester 测试
  ↓
Reviewer 审查
  ↓
最终汇报
```

优点：

- 复杂任务可以分工。
- 每个 Agent 可以专注一个能力。
- 适合大型自动化流程。

缺点：

- 成本更高。
- 速度更慢。
- 更容易跑偏。
- 调试更复杂。

建议：

> 初学者先做单 Agent，再做多 Agent。

---

# 推荐项目练习

## 入门项目

| 项目 | 练习内容 |
|---|---|
| 个人介绍页 | HTML + CSS |
| 登录页 | 表单 + 样式 |
| Todo List | JavaScript 交互 |
| 计算器 | 事件处理 |
| 图片画廊 | DOM 操作 |

---

## 前端项目

| 项目 | 练习内容 |
|---|---|
| 博客首页 | React 组件 |
| 管理后台 | 路由、表格、表单 |
| 商品列表 | 接口请求、筛选、分页 |
| 聊天界面 | 状态管理 |
| Markdown 编辑器 | 输入、预览、组件拆分 |

---

## 后端项目

| 项目 | 练习内容 |
|---|---|
| Todo API | 增删改查 |
| 用户系统 | 登录注册 |
| 博客后端 | 数据库关系 |
| 文件上传服务 | 文件处理 |
| 权限系统 | RBAC 权限控制 |

---

## 全栈项目

| 项目 | 练习内容 |
|---|---|
| 全栈博客 | 前后端打通 |
| 在线笔记 | 登录、数据库、编辑器 |
| 简单电商 | 商品、订单、用户 |
| 管理后台 | 权限、表格、搜索 |
| SaaS Demo | 用户、套餐、支付模拟 |

---

## Agent 项目

| 项目 | 练习内容 |
|---|---|
| AI 聊天机器人 | API 调用 |
| 文档问答助手 | RAG |
| 代码解释 Agent | 文件读取 |
| 自动修 bug Agent | 工具调用 |
| 研究报告 Agent | 搜索 + 总结 |
| 个人助理 Agent | 记忆 + 工具 |

---

# 推荐学习顺序

## 第 1 个月：网页基础

目标：能做静态网页。

学习：

1. HTML
2. CSS
3. JavaScript 基础
4. DOM 操作
5. 浏览器调试工具

完成项目：

- 个人主页
- 登录页
- Todo List

---

## 第 2-3 个月：现代前端

目标：能做正式前端应用。

学习：

1. TypeScript
2. React
3. Vite
4. React Router
5. 表单处理
6. 接口请求
7. 状态管理基础

完成项目：

- React Todo
- 博客前端
- 管理后台页面

---

## 第 4-5 个月：后端基础

目标：能写 API。

学习：

1. Node.js
2. Express
3. HTTP
4. REST API
5. PostgreSQL / SQLite
6. Prisma
7. 登录注册

完成项目：

- Todo API
- 用户系统
- 博客后端

---

## 第 6-7 个月：全栈项目

目标：能完成完整应用。

学习：

1. 前后端联调
2. CORS
3. Cookie / JWT
4. 数据库设计
5. 文件上传
6. 部署
7. Docker 基础

完成项目：

- 全栈博客
- 在线笔记
- 管理后台

---

## 第 8-10 个月：AI 应用

目标：能调用大模型做应用。

学习：

1. Claude API / OpenAI API
2. Prompt Engineering
3. Streaming
4. Tool Use
5. JSON 输出
6. RAG
7. Embedding
8. 成本控制

完成项目：

- AI 总结工具
- AI 翻译工具
- AI 文档问答助手
- AI 写作助手

---

## 第 11-12 个月：AI Agent

目标：能做可执行任务的 AI Agent。

学习：

1. Agent Loop
2. 工具调用
3. 多步骤任务规划
4. 文件读写
5. 命令执行
6. RAG
7. Memory
8. 多 Agent 协作
9. 权限与安全

完成项目：

- 代码审查 Agent
- 自动研究 Agent
- 自动修复测试失败 Agent
- 个人知识库 Agent

---

# 推荐技术栈

## 前端技术栈

```txt
HTML
CSS
JavaScript
TypeScript
React
Vite
Tailwind CSS
React Router
TanStack Query
Zustand
```

## 后端技术栈

```txt
Node.js
Express 或 NestJS
PostgreSQL
Prisma
Redis
JWT / Session
Docker
```

## 全栈技术栈

```txt
Next.js
TypeScript
PostgreSQL
Prisma
Auth.js
Tailwind CSS
Vercel
```

## Agent 技术栈

```txt
TypeScript
Claude API
Tool Use
Prompt Caching
RAG
Vector Database
LangGraph 或自写 Agent Loop
PostgreSQL / SQLite
```

---

# 常见误区

## 1. 只看视频不写代码

看懂不等于会。

每学一个知识点，都要写一个小 demo。

---

## 2. 一开始学太多框架

不要一开始同时学：

```txt
React + Vue + Angular + Next.js + Nuxt + NestJS + Spring
```

建议先选一条主线：

```txt
JavaScript -> TypeScript -> React -> Node.js -> Agent
```

---

## 3. 不理解 HTTP

很多前后端问题本质都是 HTTP 问题。

例如：

- 为什么接口请求失败？
- 为什么跨域？
- 为什么登录状态丢了？
- 为什么 Cookie 没带上？
- 为什么返回 401？

所以 HTTP 必须认真学。

---

## 4. 不学数据库

后端离不开数据库。

只会写接口但不会设计数据表，很难做完整项目。

---

## 5. Agent 直接上复杂框架

刚学 Agent 时，不建议马上使用复杂框架。

建议先自己写一个简单循环：

```txt
用户目标 -> 模型判断 -> 调用工具 -> 观察结果 -> 继续
```

理解本质后，再学习 LangGraph、AutoGen、CrewAI 等框架。

---

# 最终能力目标

学完后，你应该能做到：

## 前端能力

- 能写漂亮页面。
- 能做响应式布局。
- 能用 React 做组件化应用。
- 能调用后端接口。
- 能处理登录、表单、状态。
- 能优化页面性能。

## 后端能力

- 能写 REST API。
- 能设计数据库。
- 能实现登录注册。
- 能处理权限。
- 能部署服务。
- 能保证基础安全。

## Agent 能力

- 能调用 Claude API 或其他模型 API。
- 能设计 Prompt。
- 能让 AI 调用工具。
- 能做文档问答。
- 能做多步骤自动任务。
- 能设计记忆系统。
- 能控制成本和安全风险。

---

# 官方学习资源

以下是优先推荐看的官方文档：

- [MDN Web Docs](https://developer.mozilla.org/)
- [MDN Learn Web Development](https://developer.mozilla.org/en-US/docs/Learn)
- [React 官方学习文档](https://react.dev/learn)
- [Node.js 官方学习文档](https://nodejs.org/en/learn)
- [Express 官方文档](https://expressjs.com/)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Next.js 官方文档](https://nextjs.org/docs)
- [Prisma 官方文档](https://www.prisma.io/docs)
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)
- [Anthropic Claude API 文档](https://docs.anthropic.com/)
- [Anthropic Tool Use 文档](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Anthropic Prompt Caching 文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

---

# 最后总结

这条路线可以概括为：

```txt
页面结构 HTML
  ↓
页面美化 CSS
  ↓
页面交互 JavaScript
  ↓
大型前端 TypeScript + React
  ↓
后端服务 Node.js + Express
  ↓
数据存储 PostgreSQL + Prisma
  ↓
完整应用 全栈开发
  ↓
大模型 API
  ↓
工具调用 Tool Use
  ↓
知识库 RAG
  ↓
自动执行任务 Agent
```

最重要的是：

> 不要只学概念，要边学边做项目。每个阶段至少完成一个能运行的小项目。