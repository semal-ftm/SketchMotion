@echo off
REM Starts the FastAPI extraction service on http://127.0.0.1:8000
cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
