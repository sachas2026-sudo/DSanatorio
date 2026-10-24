# Reinicia panel local + tunel Cloudflare y actualiza la URL publica (sin cambiar secretos).
param(
  [string]$Root = 'C:\Sanatorio'
)

$ErrorActionPreference = 'Stop'

$PanelDir = Join-Path $Root 'panel'
$CloudDir = Join-Path $Root 'cloudflared'
$CloudExe = Join-Path $CloudDir 'cloudflared.exe'
$PanelStart = Join-Path $PanelDir 'iniciar-panel.cmd'
$DatosDir = Join-Path $Root 'datos'
$DatosFile = Join-Path $DatosDir 'sanatorio-datos.json'
$UrlFile = Join-Path $Root 'panel-url-publica.txt'
$ConfigFile = Join-Path $Root 'panel-config.json'
$PanelPort = 3780
function Write-Result {
  param(
    [bool]$Ok,
    [string]$PanelUrl = '',
    [string]$Error = ''
  )
  $obj = [ordered]@{
    ok       = $Ok
    panelUrl = $PanelUrl
    error    = $Error
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
  if ($Ok) { exit 0 } else { exit 1 }
}

function Update-PanelUrlInDatos {
  param([string]$PublicUrl)
  if (-not (Test-Path $DatosFile)) { return }
  try {
    $raw = Get-Content $DatosFile -Raw -Encoding UTF8
    $json = $raw | ConvertFrom-Json
    if (-not $json.settings) {
      $json | Add-Member -NotePropertyName settings -NotePropertyValue ([PSCustomObject]@{
          panelUrl = $PublicUrl
        })
    } else {
      $json.settings.panelUrl = $PublicUrl
    }
    if ($json.settings.PSObject.Properties.Name -contains 'panelClaveGerente') {
      $json.settings.PSObject.Properties.Remove('panelClaveGerente')
    }
    $out = $json | ConvertTo-Json -Depth 100 -Compress
    [System.IO.File]::WriteAllText($DatosFile, $out)
  } catch {
    Write-Warning "No se pudo actualizar sanatorio-datos.json: $_"
  }
}

function Update-PanelConfigUrl {
  param([string]$PublicUrl)
  if (Test-Path $ConfigFile) {
    try {
      $cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $cfg.panelUrl = $PublicUrl
      ($cfg | ConvertTo-Json -Compress) | Set-Content -Path $ConfigFile -Encoding UTF8
    } catch {
      Write-Warning "No se pudo actualizar panel-config.json: $_"
    }
  } else {
    (@{ panelUrl = $PublicUrl; syncSecret = ''; panelClaveGerente = '' } | ConvertTo-Json -Compress) |
      Set-Content -Path $ConfigFile -Encoding UTF8
  }
  Set-Content -Path $UrlFile -Value $PublicUrl -Encoding UTF8
}

try {
  if (-not (Test-Path $PanelDir)) {
    Write-Result -Ok $false -Error 'No existe C:\Sanatorio\panel. Ejecute reparar-panel.cmd primero.'
  }

  Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  if (-not (Test-Path $PanelStart)) {
    Write-Result -Ok $false -Error 'Falta iniciar-panel.cmd. Ejecute C:\Sanatorio\reparar-panel.cmd.'
  }
  Start-Process -FilePath $PanelStart -WindowStyle Hidden

  $healthUrl = "http://127.0.0.1:$PanelPort/api/health"
  $panelReady = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
      $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
      if ($resp.StatusCode -eq 200) {
        $panelReady = $true
        break
      }
    } catch {
      continue
    }
  }
  if (-not $panelReady) {
    Write-Result -Ok $false -Error "El panel no respondió en ${PanelPort} tras 30 s. Revise C:\Sanatorio\panel\iniciar-panel.cmd."
  }

  if (-not (Test-Path $CloudExe)) {
    Write-Result -Ok $false -Error 'Falta cloudflared.exe. Ejecute C:\Sanatorio\reparar-panel.cmd.'
  }

  $logFile = Join-Path $CloudDir 'quick-tunnel.log'
  if (Test-Path $logFile) {
    try {
      Remove-Item $logFile -Force -ErrorAction Stop
    } catch {
      $logFile = Join-Path $CloudDir ("quick-tunnel-{0}.log" -f (Get-Date -Format 'yyyyMMddHHmmss'))
    }
  }

  Start-Process -FilePath $CloudExe -ArgumentList @(
    'tunnel', '--url', "http://127.0.0.1:$PanelPort", '--no-autoupdate'
  ) -RedirectStandardError $logFile -WindowStyle Hidden

  $publicUrl = $null
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Test-Path $logFile)) { continue }
    $log = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
    if ($log -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
      $publicUrl = $Matches[1]
      break
    }
  }

  if (-not $publicUrl) {
    Write-Result -Ok $false -Error 'No se obtuvo URL nueva. Revise C:\Sanatorio\cloudflared\quick-tunnel.log o ejecute reparar-panel.cmd.'
  }

  Update-PanelConfigUrl -PublicUrl $publicUrl
  Update-PanelUrlInDatos -PublicUrl $publicUrl

  Write-Result -Ok $true -PanelUrl $publicUrl
} catch {
  Write-Result -Ok $false -Error $_.Exception.Message
}
