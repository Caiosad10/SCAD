@echo off
setlocal
cd /d "%~dp0"
title SCAD - Controle de Analise Documental
echo.
echo   SCAD - Controle de Analise Documental
echo   ====================================
echo   O navegador abre em http://localhost:4177
echo   Mantenha esta janela aberta; Ctrl+C encerra.
echo.
node server.mjs --open
if errorlevel 1 (
  echo.
  echo   Nao foi possivel iniciar. Confira se o Node.js esta instalado.
  pause
)
