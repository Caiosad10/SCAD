# Controle do servidor do SCAD no Windows (tarefa "SCAD Servidor", como SYSTEM).
#
#   .\servidor.ps1                -> mostra a situacao (nao precisa de admin)
#   .\servidor.ps1 -Acao parar    -> para o servidor
#   .\servidor.ps1 -Acao iniciar  -> sobe o servidor
#   .\servidor.ps1 -Acao reiniciar
#   .\servidor.ps1 -Acao instalar -> cria/atualiza a tarefa do Windows e sobe
#   .\servidor.ps1 -Acao remover  -> tira a tarefa do Windows
#
# O jeito facil no dia a dia e o atalho "SCAD - servidor (administrador)" na
# area de trabalho (scad-servidor.cmd): ele pede elevacao sozinho e mostra um
# menu com essas opcoes.
#
# Sem a tarefa instalada, "parar" e "iniciar" ainda funcionam sobre o processo
# que estiver escutando na porta 4177.
#
# ATENCAO: este arquivo e ASCII puro de proposito. O PowerShell 5.1 le .ps1 sem
# BOM como ANSI, e caracteres como travessao viram aspas tipograficas (que ele
# trata como delimitador de texto), quebrando o parser.

param(
  [ValidateSet('status', 'parar', 'iniciar', 'reiniciar', 'instalar', 'remover')]
  [string]$Acao = 'status'
)

$ErrorActionPreference = 'Stop'

$Tarefa = 'SCAD Servidor'
$Porta = 4177
$Raiz = Split-Path -Parent $PSScriptRoot
$UrlSaude = "http://127.0.0.1:$Porta/api/health"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

function Get-Escuta {
  @(Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue)
}

function Get-Dono($processId) {
  try {
    (Get-CimInstance Win32_Process -Filter "ProcessId=$processId").GetOwner().User
  } catch { '?' }
}

function Mostrar-Situacao {
  Write-Host ''
  Write-Host '  SCAD - situacao do servidor' -ForegroundColor Cyan
  Write-Host '  ---------------------------' -ForegroundColor DarkGray

  $t = Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  if ($t) {
    $i = $t | Get-ScheduledTaskInfo
    Write-Host "  Tarefa do Windows : SIM ($($t.State)) | ultimo resultado $($i.LastTaskResult) | desde $($i.LastRunTime)"
    Write-Host '                      inicia com a maquina, como SYSTEM, reinicia sozinha se cair'
  } else {
    Write-Host '  Tarefa do Windows : NAO instalada (o servidor vive enquanto alguem o subir)' -ForegroundColor Yellow
  }

  $escuta = @(Get-Escuta)
  if ($escuta.Count -gt 0) {
    foreach ($e in $escuta) {
      Write-Host "  Porta $Porta        : ouvindo | PID $($e.OwningProcess) | dono $(Get-Dono $e.OwningProcess)"
    }
    try {
      $saude = Invoke-RestMethod $UrlSaude -TimeoutSec 5
      Write-Host "  Resposta          : v$($saude.version) | schema $($saude.schemaVersion) | no ar ha $([int]$saude.uptime) s" -ForegroundColor Green
    } catch {
      Write-Host '  Resposta          : a porta responde mas a API nao (servidor iniciando?)' -ForegroundColor Yellow
    }
  } else {
    Write-Host "  Porta $Porta        : LIVRE - o servidor NAO esta no ar" -ForegroundColor Red
  }
  Write-Host ''
}

function Parar-Servidor {
  $t = Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  if ($t -and $t.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $Tarefa
    Write-Host "  Tarefa '$Tarefa' parada." -ForegroundColor Yellow
  }

  $restantes = @(Get-Escuta)
  if ($restantes.Count -eq 0) {
    Write-Host '  Servidor parado: a porta esta livre.' -ForegroundColor Green
    return
  }

  foreach ($e in $restantes) {
    Write-Host "  Encerrando processo $($e.OwningProcess) (dono: $(Get-Dono $e.OwningProcess))..."
    Stop-Process -Id $e.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 900
  if (@(Get-Escuta).Count -eq 0) {
    Write-Host '  Servidor parado: a porta esta livre.' -ForegroundColor Green
  } else {
    Write-Host '  ATENCAO: alguem continua na porta 4177.' -ForegroundColor Red
  }
}

function Iniciar-Servidor {
  $t = Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  if (-not $t) {
    Write-Host "  A tarefa '$Tarefa' nao existe. Rode com -Acao instalar." -ForegroundColor Red
    return
  }
  if (@(Get-Escuta).Count -gt 0) {
    Write-Host '  Ja existe servidor na porta 4177; nao subo outro.' -ForegroundColor Yellow
    return
  }

  Start-ScheduledTask -TaskName $Tarefa
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 300
    try {
      $saude = Invoke-RestMethod $UrlSaude -TimeoutSec 2
      Write-Host "  No ar: v$($saude.version) na porta $Porta." -ForegroundColor Green
      return
    } catch {}
  }
  Write-Host '  A tarefa foi iniciada, mas a API ainda nao respondeu. Veja logs\servidor.log' -ForegroundColor Yellow
}

function Instalar-Servidor {
  Write-Host '  Instalando a tarefa do Windows (SYSTEM, inicia com a maquina)...' -ForegroundColor Cyan
  Parar-Servidor
  & (Join-Path $PSScriptRoot 'instalar-servico-scad.ps1')
  Iniciar-Servidor
}

# Acoes que mexem na tarefa do Windows precisam de administrador.
if ($Acao -notin @('status', 'iniciar') -and -not (Test-Admin)) {
  Write-Host '  Pedindo permissao de administrador...' -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"", '-Acao', $Acao
  )
  exit 0
}

switch ($Acao) {
  'status'    { Mostrar-Situacao }
  'parar'     { Parar-Servidor; Mostrar-Situacao }
  'iniciar'   { Iniciar-Servidor; Mostrar-Situacao }
  'reiniciar' { Parar-Servidor; Iniciar-Servidor; Mostrar-Situacao }
  'instalar'  { Instalar-Servidor; Mostrar-Situacao }
  'remover'   {
    Parar-Servidor
    if (Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false
      Write-Host "  Tarefa '$Tarefa' removida." -ForegroundColor Yellow
    } else {
      Write-Host '  Nao havia tarefa para remover.' -ForegroundColor Yellow
    }
    Mostrar-Situacao
  }
}
