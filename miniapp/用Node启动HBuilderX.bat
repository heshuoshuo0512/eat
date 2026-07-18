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
  echo 未找到 Node.js。
  echo 请编辑本文件，在 NODE_HOME_ENV 中填写包含 node.exe 的目录。
  pause
  exit /b 1
)
if not exist "%NODE_HOME%\node.exe" (
  echo Node.js 路径无效：%NODE_HOME%
  pause
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"
setx NODE_HOME_ENV "%NODE_HOME%" >nul

echo Node.js: %NODE_HOME%\node.exe
call "%NODE_HOME%\node.exe" -v
echo.
echo 正在启动 HBuilderX。请在 HBuilderX 中导入 miniapp 文件夹。

set "HBUILDERX="
if defined HBUILDERX_EXE if exist "%HBUILDERX_EXE%" set "HBUILDERX=%HBUILDERX_EXE%"
if not defined HBUILDERX if exist "C:\HBuilderX\HBuilderX.exe" set "HBUILDERX=C:\HBuilderX\HBuilderX.exe"
if not defined HBUILDERX if exist "D:\HBuilderX\HBuilderX.exe" set "HBUILDERX=D:\HBuilderX\HBuilderX.exe"
if not defined HBUILDERX (
  echo 未自动找到 HBuilderX.exe。
  echo 可手动设置：set HBUILDERX_EXE=C:\路径\HBuilderX.exe
  echo Node 路径已写入新进程环境变量，请手动启动 HBuilderX 后再操作。
  pause
  exit /b 0
)
start "" "%HBUILDERX%" "%~dp0"
pause