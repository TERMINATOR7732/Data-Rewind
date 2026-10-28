@echo off
setlocal enabledelayedexpansion

echo =====================================================================
echo  DATA REWIND -- Local-First Forensic Pipeline Workbench
echo  Understand the past. Verify the present.
echo =====================================================================
echo.

REM 1. Check Python
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in PATH. Python 3.11+ is required.
    pause
    exit /b 1
)

REM 2. Check Node
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH. Node 20+ is required.
    pause
    exit /b 1
)

REM 3. Activate Virtual Environment
if exist ".venv\Scripts\activate.bat" (
    echo [INFO] Activating Python virtual environment (.venv)...
    call .venv\Scripts\activate.bat
) else (
    echo [WARNING] .venv not found. Using system Python...
)

REM 4. Check Frontend dependencies
if not exist "frontend\node_modules" (
    echo [INFO] Installing frontend dependencies...
    cd frontend && npm.cmd install && cd ..
)

echo [INFO] Starting Data Rewind API Backend (bound strictly to loopback 127.0.0.1:8000)...
start "Data Rewind API" /min cmd /c "python -m data_rewind.cli serve --port 8000"

echo [INFO] Starting Data Rewind Frontend Workbench (Vite on port 5173)...
start "Data Rewind UI" /min cmd /c "cd frontend && npm.cmd run dev"

echo [INFO] Waiting 3 seconds for services to initialize...
timeout /t 3 /nobreak >nul

echo [INFO] Opening Data Rewind Workbench in default browser...
start http://localhost:5173

echo.
echo =====================================================================
echo  Data Rewind is running locally:
echo  - Frontend UI:  http://localhost:5173
echo  - API Docs:     http://127.0.0.1:8000/api/docs
echo  - Healthcheck:  http://127.0.0.1:8000/api/v1/health
echo =====================================================================
echo  Press any key to close this launcher (services continue running).
echo.
pause
