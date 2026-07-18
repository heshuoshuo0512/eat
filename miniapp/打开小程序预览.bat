@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

echo 正在启动智慧食堂小程序视觉预览...
echo 如果浏览器没有自动打开，请手动访问：http://localhost:5190/preview.html
start "" "http://localhost:5190/preview.html"

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
if not exist "%NODE_HOME%\npx.cmd" (
  echo 未找到 npx.cmd：%NODE_HOME%
  pause
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"
call "%NODE_HOME%\npx.cmd" vite --host 0.0.0.0 --port 5190
if errorlevel 1 echo 预览服务启动失败。
pause