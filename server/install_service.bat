@echo off
:: ============================================================
:: Family Intercom - Install FastAPI as a Windows Service
:: Run this script as Administrator (right-click → Run as admin)
:: ============================================================
::
:: This uses NSSM (Non-Sucking Service Manager) to run the
:: FastAPI server as a proper Windows service that:
::   - Starts automatically when Windows boots
::   - Runs with no console window
::   - Restarts automatically if it crashes
::
:: Download NSSM first: https://nssm.cc/download
:: Place nssm.exe in this folder (server/) before running.
:: ============================================================

echo.
echo Family Intercom - Service Installer
echo =====================================

:: Check for admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Please run this script as Administrator.
    echo Right-click the file and choose "Run as administrator"
    pause
    exit /b 1
)

:: Check nssm exists
if not exist "%~dp0nssm.exe" (
    echo ERROR: nssm.exe not found in %~dp0
    echo Download from https://nssm.cc/download and place nssm.exe here.
    pause
    exit /b 1
)

:: Read JWT_SECRET from .env file
set JWT_SECRET=
for /f "tokens=2 delims==" %%a in ('findstr /i "JWT_SECRET" "%~dp0.env"') do set JWT_SECRET=%%a

if "%JWT_SECRET%"=="" (
    echo ERROR: Could not read JWT_SECRET from .env file.
    pause
    exit /b 1
)

set DIR=%~dp0
set PYTHON=python

:: Remove existing service if present
"%DIR%nssm.exe" stop FamilyIntercomServer 2>nul
"%DIR%nssm.exe" remove FamilyIntercomServer confirm 2>nul

echo Installing service...

:: Install the service
"%DIR%nssm.exe" install FamilyIntercomServer "%PYTHON%"
"%DIR%nssm.exe" set FamilyIntercomServer AppParameters -m uvicorn main:app --host 0.0.0.0 --port 8080
"%DIR%nssm.exe" set FamilyIntercomServer AppDirectory "%DIR%"
"%DIR%nssm.exe" set FamilyIntercomServer AppEnvironmentExtra "JWT_SECRET=%JWT_SECRET%"
"%DIR%nssm.exe" set FamilyIntercomServer DisplayName "Family Intercom Server"
"%DIR%nssm.exe" set FamilyIntercomServer Description "Family Intercom WebSocket signaling and API server"
"%DIR%nssm.exe" set FamilyIntercomServer Start SERVICE_AUTO_START
"%DIR%nssm.exe" set FamilyIntercomServer AppStdout "%DIR%server.log"
"%DIR%nssm.exe" set FamilyIntercomServer AppStderr "%DIR%server.log"
"%DIR%nssm.exe" set FamilyIntercomServer AppRotateFiles 1
"%DIR%nssm.exe" set FamilyIntercomServer AppRotateBytes 10485760

:: Start the service now
net start FamilyIntercomServer

echo.
echo ============================================
echo  Service installed and started!
echo  The server will now start automatically
echo  every time Windows boots.
echo.
echo  Check status: Open Services app (services.msc)
echo  View logs:    %DIR%server.log
echo  Health check: http://localhost:8080/health
echo ============================================
pause
