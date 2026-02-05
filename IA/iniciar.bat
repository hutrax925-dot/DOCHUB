@echo off
REM DocHub IA - Controle Ligar / Desligar / Reiniciar via BAT
title DocHub IA - Control

echo.
echo =========================================
echo   DocHub IA - Servidor (Controle)
echo =========================================
echo.

REM Função: verifica se Python está instalado
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python não encontrado!
    pause
    exit /b 1
)

echo ✅ Python encontrado
echo.

:MENU
echo Escolha uma opção:
echo 1) Ligar (inicia e sai)
echo 2) Sair
set /p choiceMain="Digite o número e pressione Enter: "
if "%choiceMain%"=="1" goto LIGAR_EXIT
if "%choiceMain%"=="2" goto EOF
echo Opcao inválida.
echo.
goto MENU

:LIGAR_EXIT
echo 🚀 Iniciando IA em nova janela...
REM Instala dependências básicas silenciosamente
pip install requests >nul 2>&1

REM Abre nova janela e deixa o usuário controlar (Ctrl+C) nessa janela; este script finaliza em seguida
start "DocHub IA" cmd /k python ia.py
echo IA iniciada; saindo deste menu.
exit /b 0

:EOF
echo Saindo...
exit /b 0

