@echo off
echo ============================================
echo  Family Intercom - Starting All Services
echo ============================================
echo.

:: Start FastAPI server in background
echo [1/2] Starting FastAPI signaling server on port 8080...
start "Family Intercom Server" cmd /k "cd /d "%~dp0server" && (if exist venv\Scripts\activate.bat call venv\Scripts\activate.bat) && uvicorn main:app --host 0.0.0.0 --port 8080"

:: Wait a moment for server to start
timeout /t 3 /nobreak >nul

:: Start Electron app
echo [2/2] Starting Electron desktop app...
start "Family Intercom Desktop" cmd /k "cd /d "%~dp0desktop" && npm start"

echo.
echo ============================================
echo  All services started!
echo  - Server:  http://localhost:8080
echo  - Health:  http://localhost:8080/health
echo  - WebTest: file:///path/to/test/webrtc-test.html
echo ============================================
echo.
echo NOTE: This script is for DEVELOPMENT only.
echo For production, use server\install_service.bat (NSSM) and Electron auto-launch.
pause
