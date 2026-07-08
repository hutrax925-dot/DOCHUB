@echo off
cd /d "%~dp0"

echo 🚀 Iniciando Chat IA...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python nao encontrado!
    pause
    exit /b 1
)

pip install requests >nul 2>&1
python "%~dp0ia.py"
if errorlevel 1 (
    echo ❌ Falha ao iniciar a IA.
    pause
)

