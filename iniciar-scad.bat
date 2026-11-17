@echo off
setlocal
cd /d "%~dp0"
title SCAD - Controle de Analise Documental
rem Se o servidor ja estiver no ar, so abre o navegador em vez de falhar na porta.
netstat -ano -p tcp | findstr ":4177" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   O servidor ja esta no ar. Abrindo o navegador...
  start "" "http://localhost:4177"
  timeout /t 2 >nul
  exit /b
)
echo.
echo   SCAD - Controle de Analise Documental
echo   ====================================
echo   Abra no navegador: http://localhost:4177
echo   iPad (mesma rede): confira em Ajustes - Acesso no iPad
echo   Mantenha esta janela aberta; Ctrl+C encerra.
echo.
node server.mjs
if errorlevel 1 (
  echo.
  echo   Nao foi possivel iniciar. Confira se o Node.js esta instalado.
  pause
)
