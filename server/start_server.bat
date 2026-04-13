@echo off
echo Starting Family Intercom Server...
echo Server will be available at: http://localhost:8080
echo WebSocket endpoint: ws://localhost:8080/ws/{user_id}
echo Health check: http://localhost:8080/health
echo.
echo Press Ctrl+C to stop the server.
echo.

cd /d "%~dp0"

:: Check if virtual environment exists, use it if so
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

uvicorn main:app --host 0.0.0.0 --port 8080
