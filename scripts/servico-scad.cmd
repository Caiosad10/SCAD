@echo off
rem Servidor SCAD para uso 24/7 (tarefa agendada / servico).
rem - Sem janela interativa, com log em logs\servidor.log.
rem - Configuracoes opcionais em scripts\servico.env.cmd (NODE_EXE, PORT, SCAD_DATA).
setlocal
set "RAIZ=%~dp0.."
cd /d "%RAIZ%"

if exist "%~dp0servico.env.cmd" call "%~dp0servico.env.cmd"

if not exist "%RAIZ%\logs" mkdir "%RAIZ%\logs"
if "%PORT%"=="" set "PORT=4177"
if "%SCAD_DATA%"=="" set "SCAD_DATA=%RAIZ%\data"

set "NODE_BIN=%NODE_EXE%"
if "%NODE_BIN%"=="" set "NODE_BIN=node"
if "%NODE_EXE%"=="" if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if "%NODE_EXE%"=="" if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles(x86)%\nodejs\node.exe"

chcp 65001 >nul 2>&1
echo. >> "%RAIZ%\logs\servidor.log"
echo [%DATE% %TIME%] iniciando SCAD na porta %PORT% >> "%RAIZ%\logs\servidor.log"
"%NODE_BIN%" server.mjs >> "%RAIZ%\logs\servidor.log" 2>&1
echo [%DATE% %TIME%] SCAD encerrou (codigo %ERRORLEVEL%) >> "%RAIZ%\logs\servidor.log"
