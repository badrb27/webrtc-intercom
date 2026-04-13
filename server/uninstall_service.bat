@echo off
:: Run as Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Please run as Administrator.
    pause
    exit /b 1
)

echo Stopping and removing Family Intercom service...
net stop FamilyIntercomServer 2>nul
"%~dp0nssm.exe" remove FamilyIntercomServer confirm

echo Done. Service removed.
pause
