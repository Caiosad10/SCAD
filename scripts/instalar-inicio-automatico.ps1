# Liga o servidor do SCAD sozinho quando o Sergio entra no Windows.
#
#   .\instalar-inicio-automatico.ps1            -> instala/atualiza
#   .\instalar-inicio-automatico.ps1 -Remover   -> tira da inicializacao
#   .\instalar-inicio-automatico.ps1 -Testar    -> sobe agora pelo mesmo caminho
#
# NAO precisa de administrador: usa a pasta Inicializar do usuario, que roda
# quando ele faz login. O servidor sobe escondido (script scad-silencioso.vbs),
# grava em logs\servidor.log e nao duplica instancia se a porta 4177 ja estiver
# ocupada.
#
# Para o servidor sobreviver a LOGOFF e a troca de usuario (e reiniciar sozinho
# se cair), o caminho e a tarefa do Windows como SYSTEM, que precisa de
# administrador: ver instalar-servico-scad.ps1.

param(
  [switch]$Remover,
  [switch]$Testar
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Raiz = Split-Path -Parent $ScriptDir
$Vbs = Join-Path $ScriptDir 'scad-silencioso.vbs'
$Inicializar = [Environment]::GetFolderPath('Startup')
$Atalho = Join-Path $Inicializar 'SCAD - servidor.lnk'
$Wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (-not (Test-Path $Vbs)) {
  throw "Nao encontrei o iniciador: $Vbs"
}

if ($Remover) {
  if (Test-Path $Atalho) {
    Remove-Item $Atalho -Force
    Write-Host "Removido da inicializacao: $Atalho" -ForegroundColor Yellow
  } else {
    Write-Host 'Nada para remover (o atalho nao existe).' -ForegroundColor Yellow
  }
  Write-Host 'O servidor que estiver rodando continua rodando ate ser encerrado.' -ForegroundColor DarkGray
  exit 0
}

if ($Testar) {
  Write-Host 'Subindo pelo mesmo caminho da inicializacao...' -ForegroundColor Cyan
  Start-Process -FilePath $Wscript -ArgumentList "`"$Vbs`"" -WindowStyle Hidden
  Start-Sleep -Seconds 2
  try {
    $saude = Invoke-WebRequest 'http://127.0.0.1:4177/api/health' -UseBasicParsing -TimeoutSec 5
    Write-Host "Respondeu: $($saude.Content)" -ForegroundColor Green
  } catch {
    Write-Host 'Nao respondeu ainda; confira logs\servidor.log' -ForegroundColor Red
  }
  exit 0
}

# Cria (ou refaz) o atalho da pasta Inicializar.
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($Atalho)
$lnk.TargetPath = $Wscript
$lnk.Arguments = "`"$Vbs`""
$lnk.WorkingDirectory = $Raiz
$lnk.IconLocation = "$env:ProgramFiles\nodejs\node.exe,0"
$lnk.Description = 'Servidor do SCAD (sobe escondido ao entrar no Windows)'
$lnk.WindowStyle = 7
$lnk.Save()

Write-Host "Instalado: $Atalho" -ForegroundColor Green
Write-Host "  inicia: $Vbs" -ForegroundColor DarkGray
Write-Host "  log:    $Raiz\logs\servidor.log" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Vale no proximo login. Para testar agora: .\instalar-inicio-automatico.ps1 -Testar' -ForegroundColor Cyan
Write-Host 'O atalho da area de trabalho continua servindo para subir na mao.' -ForegroundColor DarkGray
