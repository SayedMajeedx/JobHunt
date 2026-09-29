@echo off
cd /d "%~dp0"
python -c "import flask, bs4, pypdf, requests" 2>nul || (
  echo Installing requirements...
  python -m pip install -q -r requirements.txt
)
python app.py
pause
