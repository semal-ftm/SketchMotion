@echo off
REM One-time setup for SketchMotion on Windows (Python 3.10-3.12 and Node 18+ required).
setlocal
cd /d "%~dp0backend"

echo [1/3] Creating Python virtual environment...
if not exist .venv (
  py -3 -m venv .venv 2>nul || python -m venv .venv
)
call .venv\Scripts\activate.bat || goto :error

echo [2/3] Installing backend dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt || goto :error

echo [3/3] Installing frontend dependencies (also downloads the hand model)...
cd /d "%~dp0frontend"
call npm install || goto :error

echo.
echo Setup complete. Now run start-backend.bat and start-frontend.bat in two terminals.
exit /b 0

:error
echo.
echo Setup failed - see the messages above.
exit /b 1
