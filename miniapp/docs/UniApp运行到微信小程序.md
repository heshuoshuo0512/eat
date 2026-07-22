# UniApp 运行到微信小程序

## 唯一源码目录

小程序业务源码只维护在：

```text
miniapp/src
```

不要直接编辑 `miniapp/pages`、`miniapp/services` 等历史根目录副本；这些副本已经移除。`miniapp/dist` 是构建产物，也不能作为源码修改。

## 构建

在 `miniapp` 目录执行：

```bat
npm.cmd run build:mp-weixin
```

也可以在仓库根目录执行：

```bat
npm.cmd run build:miniapp
```

成功后生成：

```text
miniapp/dist/build/mp-weixin
```

## 微信开发者工具

1. 先完成 CLI 构建。
2. 在微信开发者工具中导入 `miniapp/dist/build/mp-weixin`。
3. 当前开发环境使用 HTTP API，真机调试时需启用“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。
4. 当前交付用于开发者工具和真机调试，不可直接上传为正式版本。

不要让 HBuilderX 直接运行源码目录。项目固定采用“CLI 构建，再导入微信开发者工具”的流程，避免 HBuilderX 使用错误的 Node 环境或旧源码副本。

## 发布前检查

- API 改为 HTTPS 域名。
- 在微信公众平台配置 request/uploadFile 合法域名。
- 恢复 `manifest.json` 中的域名校验。
- 使用正式 AppID、隐私指引和用户协议。
- 重新执行完整构建与小程序专项测试。
