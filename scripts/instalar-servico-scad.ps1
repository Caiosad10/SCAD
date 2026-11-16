# Instala o SCAD como tarefa agendada do Windows (inicia com a maquina, sem janela).
# Rodar como ADMINISTRADOR.
#
#   .\instalar-servico-scad.ps1            -> instala/atualiza
#   .\instalar-servico-scad.ps1 -Remover   -> remove a tarefa
#   .\instalar-servico-scad.ps1 -Iniciar   -> inicia agora (sem reiniciar)
#
# O que ele faz:
#   1. grava scripts\servico.env.cmd com o caminho do node e a porta;
#   2. cria a tarefa "SCAD Servidor" (SYSTEM, ao iniciar, reinicio automatico);
#   3. ajusta energia: nao suspender/hibernar na tomada e nao fazer nada ao fechar a tampa.
param(
  [switch]$Remover,
  [switch]$Iniciar,
  [int]$Port = 4177
)

$ErrorActionPreference = 'Stop'
$Tarefa = 'SCAD Servidor'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Raiz = Split-Path -Parent $ScriptDir
$Wrapper = Join-Path $ScriptDir 'servico-scad.cmd'
$EnvFile = Join-Path $ScriptDir 'servico.env.cmd'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

if (-not (Test-Admin)) {
  Write-Host 'ERRO: abra o PowerShell como Administrador e rode de novo.' -ForegroundColor Red
  exit 1
}

if ($Remover) {
  if (Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false
    Write-Host "Tarefa '$Tarefa' removida." -ForegroundColor Yellow
  } else {
    Write-Host "Tarefa '$Tarefa' nao existe." -ForegroundColor Yellow
  }
  Write-Host 'Obs.: o processo node que estiver rodando continua ativo ate ser encerrado.'
  exit 0
}

if ($Iniciar) {
  Start-ScheduledTask -TaskName $Tarefa
  Start-Sleep -Seconds 2
  Get-ScheduledTask -TaskName $Tarefa | Get-ScheduledTaskInfo | Format-List TaskName, LastRunTime, LastTaskResult
  exit 0
}

# --- node ---
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $tentativas = @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")
  $node = $tentativas | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $node) {
  Write-Host 'ERRO: node.exe nao encontrado. Instale o Node.js ou passe o caminho.' -ForegroundColor Red
  exit 1
}
Write-Host "Node: $node"

# --- configuracao persistente ---
$conteudo = @(
  '@echo off',
  'rem Gerado por instalar-servico-scad.ps1 - nao versionar.',
  ('set "NODE_EXE={0}"' -f $node),
  ('set "PORT={0}"' -f $Port)
) -join "`r`n"
Set-Content -Path $EnvFile -Value $conteudo -Encoding ASCII
Write-Host "Config: $EnvFile"

# --- tarefa ---
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "{0}"' -f $Wrapper) -WorkingDirectory $Raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$config = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $gatilho -Principal $principal `
  -Settings $config -Description 'SCAD - Controle de Analise Documental (servidor local)' -Force | Out-Null
Write-Host "Tarefa '$Tarefa' criada." -ForegroundColor Green

# --- energia: maquina como servidor ---
powercfg /change standby-timeout-ac 0      | Out-Null
powercfg /change hibernate-timeout-ac 0    | Out-Null
powercfg /change disk-timeout-ac 0         | Out-Null
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 | Out-Null
powercfg /setactive SCHEME_CURRENT         | Out-Null
Write-Host 'Energia ajustada: nao suspende na tomada e fechar a tampa nao faz nada.'

Write-Host ''
Write-Host 'Proximos passos:' -ForegroundColor Cyan
Write-Host '  1. Pare o servidor atual (Ctrl+C na janela do SCAD/DSH) para liberar a porta.'
Write-Host '  2. Inicie a tarefa:  .\instalar-servico-scad.ps1 -Iniciar'
Write-Host "  3. Confira:  Invoke-RestMethod http://127.0.0.1:$Port/api/health"
Write-Host '  4. Para remover:  .\instalar-servico-scad.ps1 -Remover'
