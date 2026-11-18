# Converte os desenhos EMF/WMF de um .docx para PNG numa copia do arquivo.
#
# Por que existe: fluxograma colado do Visio vira EMF dentro do .docx, e nenhum
# navegador desenha EMF/WMF. Esta rotina gera uma copia do documento com os
# desenhos trocados por PNG, que a previa do SCAD consegue mostrar. O arquivo
# original nunca e alterado: a copia fica em data/derived.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File emf2png.ps1 `
#     -Origem <arquivo.docx> -Destino <copia.docx> [-Relatorio <relatorio.json>]
#
# Saida: 0 = copia gerada (com pelo menos uma figura), 3 = nenhuma figura para
# converter, 1 = erro. O relatorio (quando pedido) recebe JSON:
#   { "figuras": 1, "conversao": [{ "de": "...emf", "para": "...png", "largura": 989 }] }

param(
  [Parameter(Mandatory = $true)][string]$Origem,
  [Parameter(Mandatory = $true)][string]$Destino,
  [Parameter(Mandatory = $false)][string]$Relatorio = '',
  [int]$LarguraMaxima = 2200
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$temporarios = New-Object System.Collections.ArrayList
$conversao = New-Object System.Collections.ArrayList
$conversaoObjetos = New-Object System.Collections.ArrayList

function Escrever-Relatorio($texto) {
  if ($Relatorio) {
    [System.IO.File]::WriteAllText($Relatorio, $texto, (New-Object System.Text.UTF8Encoding($false)))
  }
}

function Remover-Temporarios {
  foreach ($caminho in $temporarios) {
    try { if (Test-Path -LiteralPath $caminho) { Remove-Item -LiteralPath $caminho -Force } } catch { }
  }
}

function Novo-Temporario($extensao) {
  $caminho = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + $extensao)
  [void]$temporarios.Add($caminho)
  return $caminho
}

function Abrir-Zip($caminho, $modo) {
  return [System.IO.Compression.ZipFile]::Open($caminho, $modo)
}

function Ler-Entrada($arquivo, $nome) {
  $entrada = $arquivo.GetEntry($nome)
  if (-not $entrada) { return $null }
  $fluxo = $entrada.Open()
  $memoria = New-Object System.IO.MemoryStream
  $fluxo.CopyTo($memoria)
  $fluxo.Close()
  return $memoria.ToArray()
}

try {
  if (-not (Test-Path -LiteralPath $Origem)) { throw "arquivo de origem nao encontrado: $Origem" }
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $copia = Novo-Temporario '.docx'
  Copy-Item -LiteralPath $Origem -Destination $copia -Force

  # 1. Descobre os desenhos e converte cada um para PNG (arquivo fechado aqui).
  $desenhos = New-Object System.Collections.ArrayList
  $zip = Abrir-Zip $copia ([System.IO.Compression.ZipArchiveMode]::Read)
  try {
    foreach ($entrada in @($zip.Entries)) {
      if ($entrada.FullName -match '^word/media/[^/]+\.(emf|wmf)$') {
        [void]$desenhos.Add($entrada.FullName)
      }
    }
    if ($desenhos.Count -eq 0) {
      Escrever-Relatorio '{"figuras":0}'
      exit 3
    }
    foreach ($nome in $desenhos) {
      $bytes = Ler-Entrada $zip $nome
      if (-not $bytes) { continue }
      $extensao = [System.IO.Path]::GetExtension($nome)
      $temporarioDesenho = Novo-Temporario $extensao
      [System.IO.File]::WriteAllBytes($temporarioDesenho, $bytes)

      $meta = New-Object System.Drawing.Imaging.Metafile($temporarioDesenho)
      $largura = [int][Math]::Round($meta.Width)
      $altura = [int][Math]::Round($meta.Height)
      if ($largura -le 0 -or $altura -le 0) { $largura = 1200; $altura = 800 }
      if ($largura -gt $LarguraMaxima) {
        $altura = [int][Math]::Round($altura * ($LarguraMaxima / $largura))
        $largura = $LarguraMaxima
      }
      $bitmap = New-Object System.Drawing.Bitmap($largura, $altura)
      $grafico = [System.Drawing.Graphics]::FromImage($bitmap)
      $grafico.Clear([System.Drawing.Color]::White)
      $grafico.DrawImage($meta, 0, 0, $largura, $altura)
      $grafico.Dispose()
      $meta.Dispose()
      $temporarioPng = Novo-Temporario '.png'
      $bitmap.Save($temporarioPng, [System.Drawing.Imaging.ImageFormat]::Png)
      $bitmap.Dispose()

      [void]$conversao.Add([pscustomobject]@{
        de = $nome
        para = ($nome -replace '\.(emf|wmf)$', '.png')
        rgb = $temporarioPng
        largura = $largura
        altura = $altura
      })
    }
  } finally {
    $zip.Dispose()
  }

  if ($conversao.Count -eq 0) {
    Escrever-Relatorio '{"figuras":0}'
    exit 3
  }

  # 2. Grava os PNGs no pacote e apaga os desenhos antigos.
  $zip = Abrir-Zip $copia ([System.IO.Compression.ZipArchiveMode]::Update)
  try {
    foreach ($item in $conversao) {
      $novo = $zip.CreateEntry($item.para, [System.IO.Compression.CompressionLevel]::Optimal)
      $fluxo = $novo.Open()
      $bytes = [System.IO.File]::ReadAllBytes($item.rgb)
      $fluxo.Write($bytes, 0, $bytes.Length)
      $fluxo.Close()
      $antigo = $zip.GetEntry($item.de)
      if ($antigo) { $antigo.Delete() }
    }

    # 3. Aponta as referencias do documento para os PNGs novos.
    foreach ($entrada in @($zip.Entries)) {
      if ($entrada.FullName -notmatch '\.rels$') { continue }
      $texto = [System.Text.Encoding]::UTF8.GetString((Ler-Entrada $zip $entrada.FullName))
      $novoTexto = $texto
      foreach ($item in $conversao) {
        $antigoNome = [System.IO.Path]::GetFileName($item.de)
        $novoNome = [System.IO.Path]::GetFileName($item.para)
        $novoTexto = $novoTexto.Replace("media/$antigoNome", "media/$novoNome")
      }
      if ($novoTexto -ne $texto) {
        $entrada.Delete()
        $criada = $zip.CreateEntry($entrada.FullName, [System.IO.Compression.CompressionLevel]::Optimal)
        $fluxo = $criada.Open()
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($novoTexto)
        $fluxo.Write($bytes, 0, $bytes.Length)
        $fluxo.Close()
      }
    }

    $tipos = Ler-Entrada $zip '[Content_Types].xml'
    if ($tipos) {
      $textoTipos = [System.Text.Encoding]::UTF8.GetString($tipos)
      if ($textoTipos -notmatch 'Extension="png"') {
        $textoTipos = $textoTipos.Replace(
          '</Types>',
          '<Default Extension="png" ContentType="image/png"/></Types>'
        )
        $zip.GetEntry('[Content_Types].xml').Delete()
        $criada = $zip.CreateEntry('[Content_Types].xml', [System.IO.Compression.CompressionLevel]::Optimal)
        $fluxo = $criada.Open()
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($textoTipos)
        $fluxo.Write($bytes, 0, $bytes.Length)
        $fluxo.Close()
      }
    }

    # 4. O desenho colado do Visio nao vem como imagem: vem como objeto OLE
    #    (w:object + o:OLEObject) com a previa dentro (v:imagedata). A previa
    #    do navegador le imagem comum (w:pict) e ignora objeto OLE, entao aqui
    #    o objeto vira pict -- a imagem aparece e o OLE (inutil fora do Word)
    #    sai do caminho.
    foreach ($entrada in @($zip.Entries)) {
      if ($entrada.FullName -notmatch '^word/(document|header\d*|footer\d*)\.xml$') { continue }
      $texto = [System.Text.Encoding]::UTF8.GetString((Ler-Entrada $zip $entrada.FullName))
      if ($texto -notmatch '<w:object\b') { continue }
      $novoTexto = [regex]::Replace($texto, '(?s)<w:object\b[^>]*>(.*?)</w:object>', {
          param($bloco)
          $interno = $bloco.Groups[1].Value
          if ($interno -notmatch '<v:imagedata') { return $bloco.Value }
          $interno = [regex]::Replace($interno, '<o:OLEObject\b[^>]*/>', '')
          return "<w:pict>$interno</w:pict>"
        })
      if ($novoTexto -ne $texto) {
        $entrada.Delete()
        $criada = $zip.CreateEntry($entrada.FullName, [System.IO.Compression.CompressionLevel]::Optimal)
        $fluxo = $criada.Open()
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($novoTexto)
        $fluxo.Write($bytes, 0, $bytes.Length)
        $fluxo.Close()
        [void]$conversaoObjetos.Add($entrada.FullName)
      }
    }
  } finally {
    $zip.Dispose()
  }

  $pasta = Split-Path -Parent $Destino
  if ($pasta -and -not (Test-Path -LiteralPath $pasta)) {
    New-Item -ItemType Directory -Path $pasta -Force | Out-Null
  }
  Copy-Item -LiteralPath $copia -Destination $Destino -Force

  $resumo = @{
    figuras = $conversao.Count
    objetos = $conversaoObjetos.Count
    conversao = @($conversao | ForEach-Object {
      @{ de = $_.de; para = $_.para; largura = $_.largura; altura = $_.altura }
    })
  }
  Escrever-Relatorio (($resumo | ConvertTo-Json -Depth 4 -Compress))
  Remover-Temporarios
  exit 0
} catch {
  Escrever-Relatorio ((@{ figuras = 0; erro = $_.Exception.Message } | ConvertTo-Json -Compress))
  Remover-Temporarios
  exit 1
}
