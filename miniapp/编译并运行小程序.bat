@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=D:\New Folder;%PATH%"

echo ========================================
echo   智慧食堂小程序 - 编译并运行
echo ========================================
echo 当前目录: %cd%
echo Node路径: D:\New Folder\node.exe
echo.

echo [检查] node 版本...
"D:\New Folder\node.exe" -v
echo 退出码: %errorlevel%
echo.

echo [检查] npm 版本...
"D:\New Folder\npm.cmd" -v
echo 退出码: %errorlevel%
echo.

echo [1/2] 正在编译小程序...
"D:\New Folder\npm.cmd" exec -- uni build -p mp-weixin
echo 编译退出码: %errorlevel%
echo.

echo [2/2] 编译完成！
echo.
echo 按任意键打开微信开发者工具...
pause
start "" "D:\微信web开发者工具\微信web开发者工具.exe" "%~dp0dist\build\mp-weixin"
pause
