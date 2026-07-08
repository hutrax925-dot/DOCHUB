@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%~dp0.."
for %%F in ("%ROOT%") do set "ROOT=%%~fF"
set "SERVER=%ROOT%\server.py"
set "IA_START=%ROOT%\IA\iniciar.bat"

if not exist "%SERVER%" (
    echo ERRO: server.py nao encontrado em %SERVER%
    pause
    exit /b 1
)

if not exist "%IA_START%" (
    echo ERRO: iniciar.bat nao encontrado em %IA_START%
    pause
    exit /b 1
)

echo Iniciando DocHub...
echo [1/2] Iniciando servidor...
start "" /B cmd /c "cd /d ""%ROOT%"" && python server.py"

echo [2/2] Iniciando Chat IA...
start "" /B cmd /c "cd /d ""%ROOT%\IA"" && call iniciar.bat"

ping 127.0.0.1 -n 4 > nul
start "" http://127.0.0.1:8000/ >nul 2>&1

echo DocHub iniciado.
echo Feche esta janela apenas quando quiser parar os processos.
exit /b 0
