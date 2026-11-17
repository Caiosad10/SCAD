@echo off
rem SCAD - controle do servidor (pede permissao de administrador sozinho).
rem
rem   Duplo clique            -> menu
rem   scad-servidor.cmd parar -> para o servidor
rem   scad-servidor.cmd iniciar
rem   scad-servidor.cmd status
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Pedindo permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~1' -Verb RunAs"
  exit /b
)

set "acao=%~1"
if /i "%acao%"=="instalar" goto executar
if /i "%acao%"=="parar" goto executar
if /i "%acao%"=="iniciar" goto executar
if /i "%acao%"=="reiniciar" goto executar
if /i "%acao%"=="remover" goto executar
set "acao="

:menu
cls
echo.
echo   SCAD - controle do servidor   (porta 4177)
echo   =============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1" -Acao status
echo   [1] Instalar/atualizar a tarefa e subir   (servidor como SYSTEM, inicia com a maquina)
echo   [2] Parar o servidor
echo   [3] Iniciar o servidor
echo   [4] Reiniciar o servidor
echo   [5] Remover a tarefa do Windows
echo   [6] Sair
echo.
set "opcao="
set /p "opcao=  Escolha: "
if "%opcao%"=="1" set "acao=instalar"
if "%opcao%"=="2" set "acao=parar"
if "%opcao%"=="3" set "acao=iniciar"
if "%opcao%"=="4" set "acao=reiniciar"
if "%opcao%"=="5" set "acao=remover"
if "%opcao%"=="6" exit /b
if not defined acao (
  echo.
  echo   Opcao invalida.
  timeout /t 2 >nul
  goto menu
)

:executar
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1" -Acao %acao%
set "acao="
echo.
pause
goto menu
