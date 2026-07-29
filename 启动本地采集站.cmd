@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "COLLECTOR_ROOT=%CD%"
set "COLLECTOR_API_PORT=8791"
set "COLLECTOR_WEB_PORT=5176"
set "COLLECTOR_API_URL=http://127.0.0.1:%COLLECTOR_API_PORT%"
set "COLLECTOR_WEB_URL=http://127.0.0.1:%COLLECTOR_WEB_PORT%"

where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing local dependencies...
  call npm ci
  if errorlevel 1 goto install_failed
)

if not exist "collector-data\logs" mkdir "collector-data\logs"

call :api_healthy
if not errorlevel 1 goto api_ready
call :port_in_use %COLLECTOR_API_PORT%
if not errorlevel 1 goto api_conflict

echo Starting collector API on %COLLECTOR_API_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:COLLECTOR_PORT='%COLLECTOR_API_PORT%'; $env:COLLECTOR_HOST='127.0.0.1'; Start-Process -FilePath (Get-Command node).Source -ArgumentList 'collector-server/index.js' -WorkingDirectory '%COLLECTOR_ROOT%' -WindowStyle Hidden -RedirectStandardOutput '%COLLECTOR_ROOT%\collector-data\logs\api.log' -RedirectStandardError '%COLLECTOR_ROOT%\collector-data\logs\api-error.log'"
if errorlevel 1 goto api_start_failed

:api_ready
call :web_healthy
if not errorlevel 1 goto web_ready
call :port_in_use %COLLECTOR_WEB_PORT%
if not errorlevel 1 goto web_conflict

echo Starting collector web on %COLLECTOR_WEB_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:COLLECTOR_API_PROXY='%COLLECTOR_API_URL%'; Start-Process -FilePath (Get-Command npm.cmd).Source -ArgumentList @('run','dev:collector','--','--port','%COLLECTOR_WEB_PORT%') -WorkingDirectory '%COLLECTOR_ROOT%' -WindowStyle Hidden -RedirectStandardOutput '%COLLECTOR_ROOT%\collector-data\logs\web.log' -RedirectStandardError '%COLLECTOR_ROOT%\collector-data\logs\web-error.log'"
if errorlevel 1 goto web_start_failed

:web_ready
echo Waiting for the collector site...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(25); do { $api=$false; $web=$false; try { $health=Invoke-RestMethod -Uri '%COLLECTOR_API_URL%/api/collector/health' -TimeoutSec 2; $api=$health.service -eq 'collector-api' } catch {}; try { $page=Invoke-WebRequest -UseBasicParsing -Uri '%COLLECTOR_WEB_URL%' -TimeoutSec 2; $web=$page.StatusCode -eq 200 -and $page.Content.Contains('/src/main.js') } catch {}; if ($api -and $web) { exit 0 }; Start-Sleep -Milliseconds 400 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 goto startup_timeout

echo.
echo Collector site is ready: %COLLECTOR_WEB_URL%
echo Data directory: %COLLECTOR_ROOT%\collector-data
if not "%COLLECTOR_NO_OPEN%"=="1" start "" "%COLLECTOR_WEB_URL%"
exit /b 0

:api_healthy
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $health=Invoke-RestMethod -Uri '%COLLECTOR_API_URL%/api/collector/health' -TimeoutSec 2; if ($health.service -eq 'collector-api') { exit 0 } } catch {}; exit 1" >nul 2>nul
exit /b %errorlevel%

:web_healthy
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $page=Invoke-WebRequest -UseBasicParsing -Uri '%COLLECTOR_WEB_URL%' -TimeoutSec 2; if ($page.StatusCode -eq 200 -and $page.Content.Contains('/src/main.js')) { exit 0 } } catch {}; exit 1" >nul 2>nul
exit /b %errorlevel%

:port_in_use
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -State Listen -LocalPort %1 -ErrorAction SilentlyContinue) { exit 0 }; exit 1" >nul 2>nul
exit /b %errorlevel%

:missing_node
echo Node.js and npm are required. Install Node.js, then run this script again.
goto failed

:install_failed
echo Dependency installation failed. See the npm output above.
goto failed

:api_conflict
echo Port %COLLECTOR_API_PORT% is occupied by another program.
goto failed

:web_conflict
echo Port %COLLECTOR_WEB_PORT% is occupied by another program.
goto failed

:api_start_failed
echo Failed to start the collector API. Check collector-data\logs\api-error.log.
goto failed

:web_start_failed
echo Failed to start the collector web. Check collector-data\logs\web-error.log.
goto failed

:startup_timeout
echo Startup timed out. Check collector-data\logs for details.
goto failed

:failed
echo.
pause
exit /b 1
