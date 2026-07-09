@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动智慧食堂小程序视觉预览...
echo 如果浏览器没有自动打开，请手动访问：http://localhost:5190/preview.html
start "" "http://localhost:5190/preview.html"
npx vite --host 0.0.0.0 --port 5190
pause
