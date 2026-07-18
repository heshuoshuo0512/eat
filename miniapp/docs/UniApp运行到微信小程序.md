# UniApp 运行到微信小程序

## 推荐方式：HBuilderX

1. 先完全退出 HBuilderX。
2. 双击 `用Node启动HBuilderX.bat`。
3. 如果找不到 HBuilderX，手动编辑脚本顶部或在命令提示符设置：

```bat
set HBUILDERX_EXE=C:\你的HBuilderX安装目录\HBuilderX.exe
用Node启动HBuilderX.bat
```

4. 在 HBuilderX 中打开项目目录：

```text
D:\Projects\智慧食堂\miniapp
```

注意：打开的是包含 `package.json`、`manifest.json`、`pages.json` 的 `miniapp` 目录，不是 `dist` 目录。

5. 确认 HBuilderX 已识别为 uni-app 项目后，选择：

```text
运行 → 运行到小程序模拟器 → 微信开发者工具
```

6. 首次运行时，在 HBuilderX 设置中确认微信开发者工具路径，并在微信开发者工具中登录。

## 稳定备用方式：CLI 编译后导入

双击：

```text
miniapp\运行到微信开发者工具.bat
```

脚本使用本机 Node.js 执行 UniApp CLI，然后输出并尝试打开：

```text
D:\Projects\智慧食堂\miniapp\dist\build\mp-weixin
```

微信开发者工具导入的必须是这个构建产物目录，不是源码目录。

## HBuilderX 报 Node.js 未配置

HBuilderX 4.41+ 读取的是 **HBuilderX 启动时的系统环境变量**。从已经打开的 HBuilderX 内运行脚本，不会改变 HBuilderX 自身环境。必须：

1. 关闭所有 HBuilderX 窗口和进程；
2. 双击 `用Node启动HBuilderX.bat`，或把 Node.js 目录加入系统 `Path`；
3. 重新启动 HBuilderX；
4. 再执行“运行到微信开发者工具”。

本机已确认 Node.js 位于：

```text
D:\New Folder
```

该目录应同时包含：

```text
node.exe
npm.cmd
```

## 微信 AppID

`miniapp/manifest.json` 中的 `mp-weixin.appid` 目前为空，微信开发者工具项目配置使用演示 AppID。正式运行或上传前，需要在 `manifest.json` 中填写真实 AppID，并确保 API 使用 HTTPS 合法域名。
