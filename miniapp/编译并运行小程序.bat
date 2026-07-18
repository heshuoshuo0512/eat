@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo   智慧食堂小程序 - 编译并运行
echo ========================================
echo 当前目录: %cd%
echo.

set "NODE_HOME="
if defined NODE_HOME_ENV if exist "%NODE_HOME_ENV%\node.exe" set "NODE_HOME=%NODE_HOME_ENV%"
if not defined NODE_HOME if exist "D:\New Folder\node.exe" set "NODE_HOME=D:\New Folder"
if not defined NODE_HOME if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_HOME=%ProgramFiles%\nodejs"
if not defined NODE_HOME if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_HOME=%ProgramFiles(x86)%\nodejs"
if not defined NODE_HOME if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_HOME=%LocalAppData%\Programs\nodejs"
if not defined NODE_HOME for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODE_HOME set "NODE_HOME=%%~dpP"

if not defined NODE_HOME goto :node_missing
if not exist "%NODE_HOME%\node.exe" goto :node_missing
if not exist "%NODE_HOME%\npm.cmd" goto :npm_missing
set "PATH=%NODE_HOME%;%PATH%"
echo Node路径: %NODE_HOME%\node.exe
echo.

echo [检查] node 版本...
call "%NODE_HOME%\node.exe" -v
if errorlevel 1 goto :node_failed
echo.
echo [检查] npm 版本...
call "%NODE_HOME%\npm.cmd" -v
if errorlevel 1 goto :npm_failed
echo.

echo [提示] 正在把 Node.js 路径写入当前用户 PATH...
setx NODE_HOME_ENV "%NODE_HOME%" >nul
setx PATH "%PATH%" >nul
echo [提示] 请在脚本完成后完全退出并重启 HBuilderX。
echo.
echo [1/2] 正在编译小程序...
call "%NODE_HOME%\npm.cmd" run build:mp-weixin
if errorlevel 1 goto :build_failed
echo.
echo 编译完成，产物目录：%~dp0dist\build\mp-weixin
echo.
echo [2/2] 尝试打开微信开发者工具...
set "WECHAT_DEVTOOLS="
if defined WECHAT_DEVTOOLS_ENV if exist "%WECHAT_DEVTOOLS_ENV%" set "WECHAT_DEVTOOLS=%WECHAT_DEVTOOLS_ENV%"
if not defined WECHAT_DEVTOOLS if exist "D:\微信web开发者工具\微信web开发者工具.exe" set "WECHAT_DEVTOOLS=D:\微信web开发者工具\微信web开发者工具.exe"
if not defined WECHAT_DEVTOOLS if exist "%ProgramFiles(x86)%\Tencent\微信web开发者工具\微信web开发者工具.exe" set "WECHAT_DEVTOOLS=%ProgramFiles(x86)%\Tencent\微信web开发者工具\微信web开发者工具.exe"
if defined WECHAT_DEVTOOLS (
  start "" "%WECHAT_DEVTOOLS%" "%~dp0dist\build\mp-weixin"
) else (
  echo 未找到微信开发者工具，请手动导入：%~dp0dist\build\mp-weixin
)
echo.
echo 完成。按任意键退出。
pause >nul
exit /b 0

:node_missing
echo [错误] 未找到 Node.js。
echo 请安装 Node.js 18+，或设置 NODE_HOME_ENV 为包含 node.exe 的目录。
goto :failed_pause
:npm_missing
echo [错误] 找到 node.exe，但未找到 npm.cmd：%NODE_HOME%
goto :failed_pause
:node_failed
echo [错误] node.exe 无法执行。
goto :failed_pause
:npm_failed
echo [错误] npm.cmd 无法执行。
goto :failed_pause
:build_failed
echo [错误] 小程序编译失败，请查看上方输出。
:failed_pause
echo.
echo 按任意键退出。
pause >nul
exit /b 1
