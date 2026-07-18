# HBuilderX 4.41+ Node.js 配置

HBuilderX 4.41 起，CLI 项目使用本机 Node.js 执行编译。Node.js 未安装、未加入环境变量，或 HBuilderX 未重启加载新环境时，会出现 Node.js 未配置或编译失败提示。

## Windows

1. 安装 Node.js 18 或更高版本。
2. 确认安装目录存在 `node.exe` 与 `npm.cmd`，常见路径：
   - `C:\Program Files\nodejs\`
   - `%LocalAppData%\Programs\nodejs\`
3. 将 Node.js 安装目录加入系统 `Path`，然后重新打开命令提示符和 HBuilderX。
4. 在命令提示符验证：

```bat
node -v
npm -v
```

本项目的 `编译并运行小程序.bat` 会依次探测 `NODE_HOME_ENV`、当前机器已确认的 `D:\New Folder`、系统 Node.js 安装目录和 `where node` 路径，并在编译前把探测到的目录加入当前进程 `PATH`。脚本会使用 Windows `setx` 写入 `NODE_HOME_ENV` 和用户 `Path`；这只对新启动的命令行和 HBuilderX 生效，当前已打开的 HBuilderX 必须完全退出后重启。

如需手动指定路径，可在命令提示符中执行：

```bat
set NODE_HOME_ENV=D:\New Folder
编译并运行小程序.bat
```

指定目录必须同时包含 `node.exe` 和 `npm.cmd`。如果脚本提示找不到 Node.js，请在新的命令提示符验证：

```bat
where node
where npm
node -v
npm -v
```

HBuilderX 只会读取它启动时获得的系统环境变量；脚本进程里的临时 `PATH` 不会自动传给已经运行的 HBuilderX。

## macOS

HBuilderX 主要从登录 Shell 环境读取 Node.js。将 Node.js 路径加入 `~/.bash_profile`（或当前使用的登录 Shell 配置）：

```sh
export PATH="$PATH:/path/to/nodejs"
```

重新加载并验证：

```sh
source ~/.bash_profile
bash --login -c "node -v && npm -v"
```

然后重启 HBuilderX。

## 编译与微信开发者工具

在项目目录执行：

```bat
npm run build:mp-weixin
```

或运行 `编译并运行小程序.bat`。微信开发者工具只导入构建产物：

```text
miniapp/dist/build/mp-weixin
```

正式发布前仍需配置真实 AppID、HTTPS API 域名和微信公众平台合法域名；本地账号密码演示不等于正式微信登录配置已完成。
