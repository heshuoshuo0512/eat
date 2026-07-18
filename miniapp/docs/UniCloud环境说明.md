# UniCloud 与本项目

本项目当前是 **自有 Node.js API 服务** 架构，不依赖 UniCloud：

- 小程序请求 `/api/*`；
- API 服务位于项目根目录 `server/`；
- 数据库和鉴权由现有 Node 服务负责；
- `uniCloud-aliyun` 目录仅作为 HBuilderX 可识别的可选云服务目录，不是运行微信小程序的必需条件。

因此，创建 UniCloud 云环境不会解决：

```text
cli 项目运行依赖本地的 Nodejs 环境
```

该错误只与 HBuilderX 启动时是否能从系统环境变量读取 Node.js 有关。

## 什么时候需要 UniCloud

只有在项目改造成 UniCloud 云函数/云数据库架构时，才需要：

1. 在 HBuilderX 中创建 UniCloud 服务空间；
2. 配置 `uniCloud-aliyun` 或 `uniCloud-tcb`；
3. 将 API 逻辑迁移到云函数；
4. 修改小程序请求地址和鉴权流程。

本项目当前不应为了修复 Node.js 环境错误而创建 UniCloud 环境。

## 当前正确运行方式

源码目录：

```text
D:\Projects\智慧食堂\miniapp
```

CLI 编译：

```bat
cd /d "D:\Projects\智慧食堂\miniapp"
set PATH=D:\New Folder;%PATH%
D:\New Folder\npm.cmd run build:mp-weixin
```

微信开发者工具导入：

```text
D:\Projects\智慧食堂\miniapp\dist\build\mp-weixin
```
