@echo off
REM Create venv if it doesn't exist
if not exist venv (
    python -m venv venv
)

REM Activate venv
call venv\Scripts\activate

REM Install requirements if requirements.txt exists
if exist requirements.txt (
    pip install -r requirements.txt
)

REM Start app
python app.py
