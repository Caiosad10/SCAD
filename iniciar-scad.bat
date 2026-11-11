@echo off
setlocal
cd /d "%~dp0"
title SCAD - Controle de Analise Documental
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
