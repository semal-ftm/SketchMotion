@echo off
REM Starts the Vite dev server on http://localhost:5173 (proxies /api to the backend)
cd /d "%~dp0frontend"
call npm run dev
