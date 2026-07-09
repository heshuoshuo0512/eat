# 全栈 + AI Agent 完整学习路线

这份路线回答一个核心问题：

> 学全栈和 Agent，到底应该先把前端学完、再学后端、再学 Agent，还是先学通识再逐步深入？

结论是：

> **先学通识基础，再按“前端基础 → 后端基础 → 全栈打通 → AI 应用 → Agent”的顺序螺旋上升。**

不要把前端、后端、Agent 三条线完全分开学到高级。更好的方式是：

```txt
先把每一部分学到能用
  ↓
尽早做完整项目
  ↓
再回头深入每个方向的高级内容
```

---

## 一、总学习思路

错误路线：

```txt
前端从入门学到专家
  ↓
后端从入门学到专家
  ↓
Agent 从入门学到专家
```

这种路线的问题是：

- 学习周期太长。
- 很久都做不出完整项目。
- 前端、后端、Agent 之间的连接关系不清楚。
- 容易陷入“学了很多但不会做项目”的状态。

更推荐的路线：

```txt
通识基础
  ↓
前端基础
  ↓
后端基础
  ↓
数据库与鉴权
  ↓
前后端全栈项目
  ↓
Next.js 全栈框架
  ↓
AI API 应用
  ↓
RAG 与工具调用
  ↓
Agent 开发
  ↓
高级工程化与真实项目
```

一句话总结：

> **先打通完整流程，再逐块深入。**

---

## 二、完整路线总览

完整路线可以分成 11 个阶段：

```txt
第 0 阶段：开发通识
第 1 阶段：HTML / CSS / JavaScript
第 2 阶段：TypeScript
第 3 阶段：React 前端开发
第 4 阶段：Node.js 后端基础
第 5 阶段：数据库与鉴权
第 6 阶段：前后端全栈项目
第 7 阶段：Next.js 全栈框架
第 8 阶段：AI API 应用开发
第 9 阶段：RAG 与 Tool Use
第 10 阶段：AI Agent 开发
第 11 阶段：高级工程化与实战
```

---

# 第 0 阶段：开发通识

## 目标

理解所有开发方向都需要的基础概念。

无论你学前端、后端、全栈还是 Agent，这些基础都绕不开。

---

## 要学什么

| 内容 | 解释 |
|---|---|
| 文件和路径 | 知道项目文件如何组织 |
| 命令行 | 用终端执行命令 |
| npm / pnpm | 安装和管理依赖 |
| Git | 版本管理 |
| GitHub | 代码托管 |
| 浏览器开发者工具 | 调试网页和接口 |
| HTTP | 前后端通信协议 |
| JSON | 前后端传输数据的常见格式 |
| API | 前端和后端交互的接口 |
| 环境变量 | 保存端口、密钥、数据库地址等配置 |

---

## 你要达到的能力

能够看懂并使用：

```bash
npm install
npm run dev
node index.js
git add .
git commit -m "message"
```

能够理解：

```txt
GET /api/users
POST /api/login
Content-Type: application/json
```

---

## 推荐练习

```txt
1. 创建一个项目文件夹
2. 用命令行进入文件夹
3. 初始化 npm 项目
4. 创建 index.js
5. 用 node index.js 运行
6. 用 Git 保存代码
```

---

# 第 1 阶段：HTML + CSS + JavaScript

## 目标

能做一个静态网页，并添加简单交互。

前端最基础的三件事：

```txt
HTML：页面结构
CSS：页面美化
JavaScript：页面交互
```

---

## 1. HTML：页面结构

HTML 决定页面上有什么。

可以理解为：

> HTML 是网页的骨架。

示例：

```html
<h1>我的网站</h1>
<p>这是介绍文字</p>
<button>点击我</button>
```

需要掌握：

```txt
标题
段落
按钮
图片
链接
输入框
表单
列表
容器
```

---

## 2. CSS：页面美化

CSS 决定页面长什么样。

可以理解为：

> CSS 负责颜色、大小、间距、布局、动画等页面美化工作。

示例：

```css
button {
  background: blue;
  color: white;
  border-radius: 8px;
  padding: 10px 16px;
}
```

需要掌握：

```txt
颜色
字体
间距
边框
圆角
盒模型
Flex 布局
Grid 布局
响应式页面
简单动画
```

---

## 3. JavaScript：页面交互

JavaScript 让页面动起来。

可以理解为：

> JavaScript 负责用户交互和逻辑。

示例：

```js
const button = document.querySelector('button');

button.addEventListener('click', () => {
  alert('你点击了按钮');
});
```

需要掌握：

```txt
变量
函数
数组
对象
条件判断
循环
DOM
事件
fetch 请求
async / await
```

---

## 阶段项目

完成：

```txt
个人主页
登录页面
Todo List
天气查询页面
```

---

# 第 2 阶段：TypeScript

## 目标

让 JavaScript 代码更安全，更适合中大型项目。

TypeScript 可以理解为：

> TypeScript = JavaScript + 类型系统。

---

## JavaScript 和 TypeScript 的关系

```txt
TypeScript 编译后会变成 JavaScript
JavaScript 才是真正运行在浏览器或 Node.js 里的语言
```

```txt
TypeScript -> 编译 -> JavaScript -> 浏览器 / Node.js 运行
```

---

## 示例

JavaScript：

```js
function add(a, b) {
  return a + b;
}
```

TypeScript：

```ts
function add(a: number, b: number): number {
  return a + b;
}
```

如果你写：

```ts
add('1', 2);
```

TypeScript 会提前提示错误。

---

## 要学什么

| 内容 | 解释 |
|---|---|
| string | 字符串类型 |
| number | 数字类型 |
| boolean | 布尔类型 |
| array | 数组类型 |
| object | 对象类型 |
| interface | 描述对象结构 |
| type | 类型别名 |
| union | 多种类型 |
| generic | 泛型 |
| function type | 函数类型 |

---

## 阶段项目

```txt
把 JavaScript Todo List 改成 TypeScript 版本
```

---

# 第 3 阶段：React 前端开发

## 目标

能做现代前端应用。

React 可以理解为：

> React 用组件的方式搭建页面。

---

## 要学什么

| 内容 | 解释 |
|---|---|
| Component | 组件 |
| Props | 父组件传数据给子组件 |
| State | 组件自己的状态 |
| useState | 管理状态 |
| useEffect | 处理副作用，比如请求接口 |
| 条件渲染 | 根据条件显示不同内容 |
| 列表渲染 | 渲染数组 |
| 表单处理 | 登录、搜索、提交 |
| React Router | 页面路由 |
| 请求接口 | 调用后端 API |
| 状态管理 | Zustand / Redux 基础 |

---

## 示例

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

> 每点击一次按钮，页面上的数字加 1。

---

## 阶段项目

```txt
React Todo
博客前端
管理后台页面
商品列表页面
```

这一阶段不要追求太复杂的架构。

重点是掌握：

```txt
组件
状态
表单
路由
接口请求
```

---

# 第 4 阶段：Node.js 后端基础

## 目标

能写后端接口。

Node.js 可以理解为：

> Node.js 是让 JavaScript 运行在服务器上的环境。

---

## Node.js 和 Next.js 的区别

```txt
Node.js：JavaScript 后端运行环境
Next.js：基于 React 的全栈框架
```

Node.js 更底层，Next.js 更上层。

```txt
Node.js = 发动机
Next.js = 装好车身的汽车
```

---

## 要学什么

| 内容 | 解释 |
|---|---|
| Node.js | JavaScript 后端运行环境 |
| npm | 后端依赖管理 |
| Express | 写 API 的后端框架 |
| Request | 前端发来的请求 |
| Response | 后端返回的响应 |
| Middleware | 中间件 |
| REST API | 常见接口风格 |
| 错误处理 | 处理异常 |
| 环境变量 | 保存端口、密钥、数据库地址 |

---

## Express 示例

```js
import express from 'express';

const app = express();

app.get('/api/hello', (req, res) => {
  res.json({ message: '你好' });
});

app.listen(3000);
```

意思是：

> 启动一个服务器，访问 `/api/hello` 时返回 JSON 数据。

---

## 阶段项目

```txt
Todo API
用户列表 API
登录注册 API
```

---

# 第 5 阶段：数据库与鉴权

## 目标

让后端能保存数据，并支持用户登录和权限控制。

---

## 1. 数据库

建议先学：

```txt
SQLite 或 PostgreSQL
```

SQLite 适合入门。  
PostgreSQL 更适合正式项目。

---

## 要学什么

| 内容 | 解释 |
|---|---|
| 表 | 存一类数据 |
| 字段 | 表中的一列 |
| 主键 | 唯一标识一条数据 |
| 外键 | 表与表之间的关系 |
| SQL | 查询数据库的语言 |
| CRUD | 增删改查 |

---

## SQL 示例

```sql
SELECT * FROM users WHERE id = 1;
```

意思是：

> 从用户表里查出 id 为 1 的用户。

---

## 2. ORM

建议学 Prisma。

ORM 可以理解为：

> 用 TypeScript 代码操作数据库。

示例：

```ts
const user = await prisma.user.findUnique({
  where: { id: 1 },
});
```

---

## 3. 登录鉴权

要学：

| 内容 | 解释 |
|---|---|
| 注册 | 创建用户 |
| 登录 | 验证用户身份 |
| 密码哈希 | 密码不能明文存储 |
| Cookie | 浏览器保存登录信息 |
| Session | 服务端保存登录状态 |
| JWT | Token 登录方式 |
| 权限 | 判断用户能不能访问某功能 |

---

## 阶段项目

```txt
带登录的 Todo 系统
博客系统后端
用户权限管理 API
```

---

# 第 6 阶段：前后端全栈项目

## 目标

把前端、后端、数据库真正连起来。

---

## 推荐项目结构

```txt
fullstack-app/
  frontend/
    React 前端
  backend/
    Node.js + Express 后端
  database/
    数据库相关配置
```

---

## 工作流程

```txt
用户点击按钮
  ↓
React 调用 API
  ↓
Express 接收请求
  ↓
Prisma 查询数据库
  ↓
数据库返回数据
  ↓
Express 返回 JSON
  ↓
React 更新页面
```

这一步是全栈学习中最关键的阶段。

---

## 必须掌握

| 内容 | 解释 |
|---|---|
| CORS | 前后端跨域 |
| API 设计 | 接口路径和参数设计 |
| 表单提交 | 前端提交数据给后端 |
| 登录状态 | 前端保存并携带登录信息 |
| 错误提示 | 接口失败时显示错误 |
| 加载状态 | 请求中显示 loading |
| 分页搜索 | 常见业务功能 |
| 文件上传 | 上传图片或文件 |

---

## 阶段项目

认真做完其中一个：

```txt
全栈博客
在线笔记
用户管理系统
简单电商后台
```

---

# 第 7 阶段：Next.js 全栈框架

## 目标

用一个框架同时写前端和后端。

Next.js 可以理解为：

> Next.js = React + 路由 + 服务端渲染 + 后端接口 + 构建部署能力。

---

## 为什么这时才学 Next.js

因为你已经理解了：

```txt
React 是什么
后端 API 是什么
数据库是什么
登录是什么
```

这时学 Next.js 才不会混乱。

如果一开始就学 Next.js，很容易被这些概念同时淹没：

```txt
React
路由
SSR
SSG
API Route
Server Component
部署
缓存
```

---

## Next.js 包含什么

| 内容 | 解释 |
|---|---|
| React 页面 | 写前端页面 |
| 文件路由 | 文件结构就是路由 |
| Server Component | 服务端组件 |
| Route Handler | 写后端接口 |
| SSR | 服务端渲染 |
| SSG | 静态生成 |
| Middleware | 中间件 |
| SEO | 搜索引擎优化 |
| 部署 | 常配合 Vercel |

---

## 推荐技术栈

```txt
Next.js
TypeScript
Tailwind CSS
Prisma
PostgreSQL
Auth.js
```

---

## 阶段项目

```txt
Next.js 博客
Next.js 在线笔记
Next.js AI 聊天网页
```

---

# 第 8 阶段：AI API 应用开发

## 目标

能把大模型接入自己的应用。

AI 应用不是 Agent，它只是调用大模型完成某个功能。

---

## 要学什么

| 内容 | 解释 |
|---|---|
| Claude API / OpenAI API | 调用大模型 |
| API Key | 模型调用密钥 |
| Prompt | 给模型的指令 |
| Messages | 对话消息 |
| Streaming | 流式输出 |
| JSON 输出 | 让模型返回结构化数据 |
| Token | 模型处理文本的单位 |
| 成本控制 | 控制 API 调用费用 |
| Prompt Caching | 缓存长提示词降低成本 |

---

## 基础流程

```txt
用户输入问题
  ↓
前端发送给后端
  ↓
后端调用模型 API
  ↓
模型返回结果
  ↓
后端返回给前端
  ↓
前端显示回答
```

---

## 阶段项目

```txt
AI 聊天网页
AI 总结工具
AI 翻译工具
AI 简历优化器
AI 文档问答雏形
```

---

# 第 9 阶段：RAG 与 Tool Use

## 目标

让 AI 可以查资料、用工具，而不是只靠模型记忆回答。

---

## 1. RAG

RAG 可以理解为：

> 先搜索资料，再让模型基于资料回答。

适合：

```txt
文档问答
知识库问答
项目代码问答
客服机器人
法律、医疗、财务资料问答
```

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

要学：

| 内容 | 解释 |
|---|---|
| Embedding | 把文本变成向量 |
| Vector Database | 向量数据库 |
| Chunking | 文档切片 |
| Retrieval | 检索 |
| Rerank | 重新排序 |
| Citation | 引用来源 |
| Hallucination | 模型幻觉 |

---

## 2. Tool Use

Tool Use 是 Agent 的基础。

普通 AI 只能回答。  
有工具调用后，AI 可以做事。

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

---

## 阶段项目

```txt
个人知识库问答
项目文档问答系统
能搜索资料的 AI 助手
能调用一个工具的 AI 助手
```

---

# 第 10 阶段：AI Agent 开发

## 目标

让 AI 不只是回答，而是能调用工具完成任务。

Agent 可以理解为：

> 大模型 + 工具 + 任务规划 + 记忆 + 执行循环。

---

## 普通 AI 和 Agent 的区别

普通 AI：

```txt
用户问
AI 答
```

Agent：

```txt
用户给目标
AI 判断下一步
AI 调用工具
AI 观察结果
AI 继续行动
直到任务完成
```

---

## Agent Loop

Agent Loop 是 Agent 的核心工作循环。

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

---

## 要学什么

| 内容 | 解释 |
|---|---|
| Tool Use | 让模型调用工具 |
| Function Calling | 函数调用 |
| Agent Loop | 执行循环 |
| Planning | 任务规划 |
| Memory | 记忆系统 |
| RAG | 检索资料后回答 |
| Vector Database | 向量数据库 |
| Embedding | 文本向量化 |
| Permissions | 工具权限控制 |
| Evaluation | 评估 Agent 效果 |
| Multi-Agent | 多 Agent 分工协作 |

---

## Agent 示例流程

用户：

```txt
帮我总结这个项目的问题
```

Agent：

```txt
1. 读取项目文件
2. 分析目录结构
3. 搜索关键代码
4. 总结技术栈
5. 找出潜在问题
6. 输出报告
```

---

## 阶段项目

按顺序做：

```txt
1. 会调用一个工具的 Agent
2. 会调用多个工具的 Agent
3. 带记忆的聊天 Agent
4. 文档问答 RAG Agent
5. 能执行任务的自动化 Agent
6. 代码审查 Agent
7. 个人知识库 Agent
```

---

# 第 11 阶段：高级工程化与实战

## 目标

把项目做得更像真实产品。

---

## 前端高级

```txt
性能优化
组件库设计
状态管理
复杂表单
前端测试
SSR / SSG
可访问性
国际化
```

---

## 后端高级

```txt
缓存 Redis
消息队列
任务调度
日志系统
监控告警
权限系统
微服务基础
高并发基础
接口安全
```

---

## Agent 高级

```txt
长期记忆
复杂工具调用
多 Agent 协作
任务队列
沙箱执行
权限隔离
成本优化
Agent 评估
Human-in-the-loop 人类确认
```

---

# 12 个月学习计划

如果每天学习 2-3 小时，可以按下面节奏走。

---

## 第 1 个月：基础网页

学习：

```txt
HTML
CSS
JavaScript 基础
DOM
事件
fetch
```

项目：

```txt
个人主页
Todo List
天气查询页面
```

---

## 第 2 个月：TypeScript + React

学习：

```txt
TypeScript
React 组件
useState
useEffect
Props
表单
路由
```

项目：

```txt
React Todo
博客前端
管理后台页面
```

---

## 第 3 个月：Node.js + Express

学习：

```txt
Node.js
Express
REST API
中间件
错误处理
环境变量
```

项目：

```txt
Todo API
用户 API
登录 API
```

---

## 第 4 个月：数据库

学习：

```txt
SQL
PostgreSQL 或 SQLite
Prisma
数据表设计
CRUD
表关系
```

项目：

```txt
带数据库的 Todo API
博客后端
用户系统
```

---

## 第 5 个月：登录与权限

学习：

```txt
密码哈希
Cookie
Session
JWT
权限控制
接口安全
```

项目：

```txt
完整登录注册系统
带权限的后台 API
```

---

## 第 6 个月：前后端分离全栈

学习：

```txt
React + Express
接口联调
CORS
登录状态
错误提示
分页搜索
文件上传
```

项目：

```txt
全栈博客
在线笔记
用户管理系统
```

---

## 第 7 个月：Next.js

学习：

```txt
Next.js App Router
Server Component
Route Handler
SSR
SSG
Middleware
部署
```

项目：

```txt
Next.js 博客
Next.js 在线笔记
```

---

## 第 8 个月：AI API 应用

学习：

```txt
Claude API / OpenAI API
Prompt
Streaming
JSON 输出
Token
成本控制
```

项目：

```txt
AI 聊天网页
AI 总结工具
AI 翻译工具
```

---

## 第 9 个月：RAG 文档问答

学习：

```txt
Embedding
文档切片
向量数据库
检索
引用来源
减少幻觉
```

项目：

```txt
个人知识库问答
项目文档问答系统
```

---

## 第 10 个月：Tool Use Agent

学习：

```txt
工具调用
函数调用
多工具选择
工具结果回传
权限控制
```

项目：

```txt
能搜索资料的 Agent
能读写文件的 Agent
能调用 API 的 Agent
```

---

## 第 11 个月：Agent Loop + Memory

学习：

```txt
Agent Loop
任务规划
短期记忆
长期记忆
任务状态
失败重试
人工确认
```

项目：

```txt
自动研究报告 Agent
个人助理 Agent
自动整理资料 Agent
```

---

## 第 12 个月：综合实战

学习：

```txt
部署
测试
日志
监控
安全
性能优化
多 Agent
```

最终项目：

```txt
AI 个人知识库系统
AI 代码审查平台
AI 学习助手
AI 自动研究报告工具
AI 项目管理助手
```

---

# 最推荐的学习顺序

如果你想直接照着学，可以按这个顺序：

```txt
1. 命令行、Git、HTTP、JSON、API
2. HTML
3. CSS
4. JavaScript
5. TypeScript
6. React
7. Node.js
8. Express
9. 数据库 SQL
10. Prisma
11. 登录注册和权限
12. 前后端分离全栈项目
13. Next.js
14. Claude API / OpenAI API
15. AI 聊天应用
16. RAG 文档问答
17. Tool Use 工具调用
18. Memory 记忆系统
19. Agent Loop
20. Multi-Agent
21. 工程化、部署、安全、测试
```

---

# 不建议的学习方式

## 错误路线 1：前端学太久不碰后端

```txt
HTML 学三个月
CSS 学三个月
JavaScript 学半年
React 学半年
然后还没写过后端
```

问题：

```txt
学得太散，迟迟做不出完整项目。
```

---

## 错误路线 2：刚学 JavaScript 就学 Agent 框架

问题：

```txt
你会看不懂 API、异步、后端、数据库、工具调用。
```

---

## 错误路线 3：一上来学 Next.js

问题：

```txt
Next.js 同时包含 React、后端、路由、SSR、部署。
基础不够会混乱。
```

---

## 错误路线 4：前端、后端、Agent 三条线完全分开学

问题：

```txt
你不知道它们怎么连接。
```

---

# 核心原则

## 原则 1：先通识，后分支

先学所有方向都用得到的东西：

```txt
命令行
Git
HTTP
JSON
API
JavaScript
TypeScript
```

---

## 原则 2：先能跑，再高级

不要一开始追求架构。

先让项目跑起来：

```txt
页面能显示
按钮能点击
接口能请求
数据库能保存
AI 能回复
Agent 能调用工具
```

---

## 原则 3：尽早做完整小项目

小而完整，比大而烂更重要。

一个好项目最好包含：

```txt
登录
增删改查
数据库
前端页面
后端接口
部署
```

---

## 原则 4：Agent 要放在全栈之后

因为 Agent 需要：

```txt
后端能力
API 能力
异步能力
工具调用能力
数据存储能力
安全意识
```

所以 Agent 不适合最开始学。

---

# 最终总结

你的目标如果是：

```txt
前端 + 后端 + AI Agent
```

最适合你的路线是：

```txt
先学共同基础
再学前端能做页面
再学后端能给数据
再做全栈项目
再接入 AI API
最后升级成 Agent
```

不要想着某一块一次性学到顶。

正确节奏是：

```txt
每个部分先学到能用
  ↓
做一个完整项目
  ↓
再回头深入高级内容
```

一句话总结：

> **全栈学习不是三条线分开爬到山顶，而是先修一条能走通的路，再把每段路修宽、修稳、修高级。**
