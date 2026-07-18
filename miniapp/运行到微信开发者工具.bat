@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "NODE_HOME="
if defined NODE_HOME_ENV if exist "%NODE_HOME_ENV%\node.exe" set "NODE_HOME=%NODE_HOME_ENV%"
if not defined NODE_HOME if exist "D:\New Folder\node.exe" set "NODE_HOME=D:\New Folder"
if not defined NODE_HOME if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_HOME=%ProgramFiles%\nodejs"
if not defined NODE_HOME if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_HOME=%ProgramFiles(x86)%\nodejs"
if not defined NODE_HOME if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_HOME=%LocalAppData%\Programs\nodejs"
if not defined NODE_HOME (
  echo 未找到 Node.js，请安装 Node.js 或设置 NODE_HOME_ENV。
  pause
  exit /b 1
)
if not exist "%NODE_HOME%\npm.cmd" (
  echo 未找到 npm.cmd：%NODE_HOME%
  pause
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"

echo [1/2] 使用 UniApp CLI 编译微信小程序...
call "%NODE_HOME%\npm.cmd" run build:mp-weixin
if errorlevel 1 (
  echo 编译失败。
  pause
  exit /b 1
)

echo.
echo [2/2] 编译完成。
echo 请在微信开发者工具中导入：
echo %~dp0dist\build\mp-weixin

echo.
set "WECHAT_DEVTOOLS="
if defined WECHAT_DEVTOOLS_ENV if exist "%WECHAT_DEVTOOLS_ENV%" set "WECHAT_DEVTOOLS=%WECHAT_DEVTOOLS_ENV%"
if not defined WECHAT_DEVTOOLS if exist "D:\微信web开发者工具\微信web开发者工具.exe" set "WECHAT_DEVTOOLS=D:\微信web开发者工具\微信web开发者工具.exe"
if not defined WECHAT_DEVTOOLS if exist "%ProgramFiles(x86)%\Tencent\微信web开发者工具\微信web开发者工具.exe" set "WECHAT_DEVTOOLS=%ProgramFiles(x86)%\Tencent\微信web开发者工具\微信web开发者工具.exe"
if defined WECHAT_DEVTOOLS start "" "%WECHAT_DEVTOOLS%" "%~dp0dist\build\mp-weixin"
if not defined WECHAT_DEVTOOLS echo 未找到微信开发者工具，请手动打开并导入上面的目录。
pause