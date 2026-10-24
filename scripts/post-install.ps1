# Post-instalacion / actualizacion: C:\Sanatorio (panel + Cloudflare).
# Instalador NSIS o manual. En actualizacion conserva datos, usuarios y claves.

param(
  [string]$AppDir = 'C:\Sanatorio\app',
  [switch]$SkipTunnel,
  [switch]$Upgrade,
  [switch]$RenewTunnel,
  # Instalador NSIS: no despliega panel, Node, cloudflared ni abre puertos (3780 / tunel).
  [switch]$SkipPanel
)

$AppDir = $AppDir.Trim().Trim('"')
$ErrorActionPreference = 'Stop'

$stopScript = Join-Path $PSScriptRoot 'stop-sanatorio-for-install.ps1'
if (Test-Path $stopScript) {
  & $stopScript
}

$Root = 'C:\Sanatorio'
$DatosDir = Join-Path $Root 'datos'
$PanelDir = Join-Path $Root 'panel'
$NodeDir = Join-Path $Root 'node'
$CloudDir = Join-Path $Root 'cloudflared'
$CloudExe = Join-Path $CloudDir 'cloudflared.exe'
$NodeExe = Join-Path $NodeDir 'node.exe'
$PanelCjs = Join-Path $PanelDir 'panel.cjs'
$PanelEnv = Join-Path $PanelDir '.env'
$PanelStart = Join-Path $PanelDir 'iniciar-panel.cmd'
$ConfigFile = Join-Path $Root 'panel-config.json'
$UrlFile = Join-Path $Root 'panel-url-publica.txt'
$TaskStopOnShutdown = 'SanatorioPanelStop'
$PanelPort = 3780
$NodeVersion = 'v20.18.0'

. (Join-Path $PSScriptRoot 'panel-autostart-task-names.ps1')

function Test-ExistingSanatorioInstall {
  $datosJson = Join-Path $DatosDir 'sanatorio-datos.json'
  if (-not (Test-Path $datosJson)) { return $false }
  @(
    (Join-Path $DatosDir 'auth-accounts.json'),
    (Join-Path $DatosDir 'panel-sync-secret.txt'),
    (Join-Path $DatosDir 'smtp-secret.txt')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Read-EnvFileValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path -ErrorAction SilentlyContinue) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+)\s*$") {
      return $Matches[1].Trim().Trim('"')
    }
  }
  return $null
}

function Read-ExistingPanelSecrets {
  $sync = $null
  $clave = $null
  $url = $null

  $secretFile = Join-Path $DatosDir 'panel-sync-secret.txt'
  if (Test-Path $secretFile) {
    $sync = (Get-Content $secretFile -Raw -ErrorAction SilentlyContinue).Trim()
  }

  $claveFile = Join-Path $DatosDir 'panel-clave-gerente.txt'
  if (Test-Path $claveFile) {
    $clave = (Get-Content $claveFile -Raw -ErrorAction SilentlyContinue).Trim()
  }

  if (Test-Path $PanelEnv) {
    if (-not $sync) { $sync = Read-EnvFileValue -Path $PanelEnv -Key 'PANEL_SYNC_SECRET' }
    if (-not $clave) { $clave = Read-EnvFileValue -Path $PanelEnv -Key 'PANEL_VIEW_PASSWORD' }
  }

  if (Test-Path $ConfigFile) {
    try {
      $cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if (-not $sync -and $cfg.syncSecret) { $sync = [string]$cfg.syncSecret }
      if (-not $clave -and $cfg.panelClaveGerente) { $clave = [string]$cfg.panelClaveGerente }
      if ($cfg.panelUrl) { $url = [string]$cfg.panelUrl }
    } catch { }
  }

  if (-not $url -and (Test-Path $UrlFile)) {
    $url = (Get-Content $UrlFile -Raw -ErrorAction SilentlyContinue).Trim()
  }

  return @{ syncSecret = $sync; viewPassword = $clave; panelUrl = $url }
}

function New-RandomHex([int]$Bytes = 24) {
  $buf = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return ([BitConverter]::ToString($buf) -replace '-', '').ToLower()
}

function New-GerentePassword {
  $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 12
  $rng.GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Ensure-Node {
  if (Test-Path $NodeExe) { return }
  New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
  $zipUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
  $zipPath = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
  Write-Host "Descargando Node.js $NodeVersion..." -ForegroundColor Yellow
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  $extractDir = Join-Path $env:TEMP "node-$NodeVersion-win-x64"
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
  Copy-Item (Join-Path $extractDir 'node.exe') $NodeExe -Force
  Write-Host "Node.js en $NodeExe" -ForegroundColor Green
}

function Ensure-Cloudflared {
  if (Test-Path $CloudExe) { return }
  New-Item -ItemType Directory -Force -Path $CloudDir | Out-Null
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Write-Host 'Descargando cloudflared...' -ForegroundColor Yellow
  Invoke-WebRequest -Uri $url -OutFile $CloudExe -UseBasicParsing
}

function Copy-PanelFromInstaller {
  $AppDirLocal = $AppDir.Trim().Trim('"')
  $zipCandidates = @(
    (Join-Path $AppDirLocal 'panel-bundle.zip'),
    (Join-Path $AppDirLocal 'resources\panel-bundle.zip'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'src-tauri\installer-assets\panel-bundle.zip')
  )
  foreach ($zip in $zipCandidates) {
    if (Test-Path $zip) {
      if (Test-Path $PanelDir) {
        Remove-Item $PanelDir -Recurse -Force -ErrorAction SilentlyContinue
      }
      New-Item -ItemType Directory -Force -Path $PanelDir | Out-Null
      Expand-Archive -Path $zip -DestinationPath $PanelDir -Force
      if (Test-Path (Join-Path $PanelDir 'panel.cjs')) {
        Write-Host "Panel extraido desde $zip" -ForegroundColor Green
        return
      }
    }
  }

  $candidates = @(
    (Join-Path $AppDirLocal 'panel'),
    (Join-Path $AppDirLocal 'resources\panel'),
    (Join-Path $AppDirLocal 'src-tauri\installer-assets\panel'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'src-tauri\installer-assets\panel')
  )
  $src = $null
  foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c 'panel.cjs')) {
      $src = $c
      break
    }
  }
  if (-not $src) {
    throw "No se encontro panel.cjs ni panel-bundle.zip. Ejecute: npm run installer:bundle-panel"
  }
  New-Item -ItemType Directory -Force -Path $PanelDir | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $PanelDir -Recurse -Force
}

function Write-PanelEnvFile {
  param(
    [string]$SyncSecret,
    [string]$ViewPassword
  )
  @"
PANEL_PORT=$PanelPort
PANEL_SYNC_SECRET=$SyncSecret
PANEL_VIEW_PASSWORD=$ViewPassword
PANEL_SECURE_COOKIE=1
"@ | Set-Content -Path $PanelEnv -Encoding UTF8
}

function Remove-PanelAutoStartTasks {
  Remove-PanelAutoStartScheduledTasks
}

function Install-PanelStartScript {
  @"
@echo off
set SANATORIO_PANEL_ROOT=$PanelDir
set SANATORIO_DATOS=$DatosDir
set PANEL_PORT=$PanelPort
:panel_loop
"$NodeExe" "$PanelCjs"
echo [%date% %time%] Panel detenido, reiniciando en 5 s...
timeout /t 5 /nobreak >nul
goto panel_loop
"@ | Set-Content -Path $PanelStart -Encoding ASCII
  Write-Host "Script panel: $PanelStart (reinicio automatico si se cae)" -ForegroundColor Gray
}

function Install-TunnelStartScript {
  Ensure-Cloudflared
  $tunnelStart = Join-Path $CloudDir 'iniciar-tunel.cmd'
  @"
@echo off
"$CloudExe" tunnel --url http://127.0.0.1:$PanelPort --no-autoupdate
"@ | Set-Content -Path $tunnelStart -Encoding ASCII
  Write-Host "Script tunel: $tunnelStart (solo manual / Reactivar panel)" -ForegroundColor Gray
}

function Start-QuickTunnelNow {
  Ensure-Cloudflared
  $logFile = Join-Path $CloudDir 'quick-tunnel.log'
  if (Test-Path $logFile) {
    try {
      Remove-Item $logFile -Force -ErrorAction Stop
    } catch {
      $logFile = Join-Path $CloudDir ("quick-tunnel-{0}.log" -f (Get-Date -Format 'yyyyMMddHHmmss'))
    }
  }

  Install-TunnelStartScript

  Start-Process -FilePath $CloudExe -ArgumentList @(
    'tunnel', '--url', "http://127.0.0.1:$PanelPort", '--no-autoupdate'
  ) -RedirectStandardError $logFile -WindowStyle Hidden

  $publicUrl = $null
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $logFile) {
      $log = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
      if ($log -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
        $publicUrl = $Matches[1]
        break
      }
    }
  }
  return $publicUrl
}

function Install-PanelShutdownStop {
  $srcStop = Join-Path $PSScriptRoot 'stop-panel-services.ps1'
  $destStop = Join-Path $Root 'stop-panel-services.ps1'
  if (Test-Path $srcStop) {
    Copy-Item -Path $srcStop -Destination $destStop -Force
  } elseif (-not (Test-Path $destStop)) {
    Write-Host 'Aviso: no se copio stop-panel-services.ps1' -ForegroundColor Yellow
    return
  }

  $existing = Get-ScheduledTask -TaskName $TaskStopOnShutdown -ErrorAction SilentlyContinue
  if ($existing) { Unregister-ScheduledTask -TaskName $TaskStopOnShutdown -Confirm:$false }

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', $destStop
  )
  $triggerLogoff = New-ScheduledTaskTrigger -AtLogOff -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskStopOnShutdown -Action $action -Trigger $triggerLogoff `
    -Settings $settings -Principal $principal `
    -Description 'Detiene panel y tunel Cloudflare al cerrar sesion o apagar' | Out-Null
  Write-Host "Tarea $TaskStopOnShutdown: detiene panel/tunel al apagar o cerrar sesion" -ForegroundColor Gray
}

function Copy-PanelMaintenanceScripts {
  $reactivarSrc = Join-Path $PSScriptRoot 'reactivar-panel.ps1'
  $reactivarDest = Join-Path (Join-Path $Root 'app') 'reactivar-panel.ps1'
  if (Test-Path $reactivarSrc) {
    Copy-Item -Path $reactivarSrc -Destination $reactivarDest -Force
  }
  Install-PanelShutdownStop
}

function Write-PanelIntoDatos {
  param(
    [string]$PublicUrl,
    [string]$SyncSecret,
    [string]$ViewPassword,
    [switch]$PreserveSecrets
  )

  New-Item -ItemType Directory -Force -Path $DatosDir | Out-Null

  $secretFile = Join-Path $DatosDir 'panel-sync-secret.txt'
  if ($PreserveSecrets -and (Test-Path $secretFile)) {
    Write-Host 'Se conserva panel-sync-secret.txt' -ForegroundColor Gray
  } elseif ($SyncSecret) {
    [System.IO.File]::WriteAllText($secretFile, $SyncSecret.Trim())
  }

  if ($ViewPassword) {
    $claveFile = Join-Path $DatosDir 'panel-clave-gerente.txt'
    if ($PreserveSecrets -and (Test-Path $claveFile)) {
      Write-Host 'Se conserva panel-clave-gerente.txt' -ForegroundColor Gray
    } else {
      [System.IO.File]::WriteAllText($claveFile, $ViewPassword.Trim())
    }
  }

  $datosFile = Join-Path $DatosDir 'sanatorio-datos.json'
  if (-not (Test-Path $datosFile)) { return }

  try {
    $raw = Get-Content $datosFile -Raw -Encoding UTF8
    $json = $raw | ConvertFrom-Json
    if (-not $json.settings) {
      $json | Add-Member -NotePropertyName settings -NotePropertyValue ([PSCustomObject]@{
        panelUrl = ''
      })
    }
    if ($PublicUrl -and [string]::IsNullOrWhiteSpace([string]$json.settings.panelUrl)) {
      $json.settings.panelUrl = $PublicUrl
    }
    if ($json.settings.PSObject.Properties.Name -contains 'panelClaveGerente') {
      $json.settings.PSObject.Properties.Remove('panelClaveGerente')
    }
    $out = $json | ConvertTo-Json -Depth 100 -Compress
    [System.IO.File]::WriteAllText($datosFile, $out)
    Write-Host 'Panel aplicado (URL en JSON si faltaba; secretos en archivos locales)' -ForegroundColor Green
  } catch {
    Write-Host "No se pudo actualizar sanatorio-datos.json: $_" -ForegroundColor Yellow
  }
}

function Write-PanelConfigFile {
  param(
    [string]$PublicUrl,
    [string]$SyncSecret,
    [string]$ViewPassword,
    [switch]$PreserveSecrets
  )

  $panelUrl = $PublicUrl
  $sync = $SyncSecret
  $clave = $ViewPassword

  if ($PreserveSecrets -and (Test-Path $ConfigFile)) {
    try {
      $existing = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($existing.syncSecret) { $sync = [string]$existing.syncSecret }
      if ($existing.panelClaveGerente) { $clave = [string]$existing.panelClaveGerente }
      if (-not $panelUrl -and $existing.panelUrl) { $panelUrl = [string]$existing.panelUrl }
    } catch { }
  }

  $config = @{
    panelUrl = if ($panelUrl) { $panelUrl } else { '' }
    syncSecret = $sync
    panelClaveGerente = $clave
  } | ConvertTo-Json -Compress

  Set-Content -Path $ConfigFile -Value $config -Encoding UTF8
}

function Write-ShortcutScripts {
  $repairCmd = Join-Path $Root 'reparar-panel.cmd'
  $upgradeCmd = Join-Path $Root 'actualizar-panel.cmd'
  $openCmd = Join-Path $Root 'Abrir Centro Medico.cmd'
  $postInstall = Join-Path (Join-Path $Root 'app') 'post-install.ps1'
  if (-not (Test-Path $postInstall)) {
    $postInstall = Join-Path (Join-Path $Root 'app') 'resources\post-install.ps1'
  }
  $appExe = Join-Path (Join-Path $Root 'app') 'app.exe'

  @"
@echo off
start "" "$appExe"
"@ | Set-Content -Path $openCmd -Encoding ASCII

  @"
@echo off
echo Reparando panel web Sanatorio (conserva datos y claves)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$postInstall" -AppDir "C:\Sanatorio\app" -Upgrade
echo.
echo Listo. Abra la app.
pause
"@ | Set-Content -Path $repairCmd -Encoding ASCII

  @"
@echo off
echo Actualizando codigo del panel Sanatorio (conserva datos y claves)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$postInstall" -AppDir "C:\Sanatorio\app" -Upgrade
echo.
echo Listo.
pause
"@ | Set-Content -Path $upgradeCmd -Encoding ASCII

  $readme = Join-Path $Root 'LEEME-ACTUALIZACION.txt'
  @"
Centro Medico — Actualizar el programa sin perder datos
======================================================

Sus datos estan en:
  C:\Sanatorio\datos\     (pacientes, turnos, pagos, usuarios, claves)
  C:\Sanatorio\respaldo\  (copias de seguridad)

El programa (.exe) esta en:
  C:\Sanatorio\app\

Para instalar una version nueva:
  1. Cierre la app si esta abierta.
  2. Ejecute el instalador nuevo (mismo asistente de siempre).
  3. No desinstale antes: el instalador solo reemplaza C:\Sanatorio\app\.
  4. Abra la app: sus datos y configuracion siguen igual.

Opcional tras actualizar el panel web:
  C:\Sanatorio\actualizar-panel.cmd

"@ | Set-Content -Path $readme -Encoding UTF8
}

$isUpgrade = $Upgrade.IsPresent -or (Test-ExistingSanatorioInstall)

Write-Host ''
if ($isUpgrade) {
  Write-Host '=== Sanatorio — Actualizacion (conserva datos) ===' -ForegroundColor Cyan
} else {
  Write-Host '=== Sanatorio — Instalacion nueva ===' -ForegroundColor Cyan
}

$logFile = Join-Path $Root 'install-panel.log'
Start-Transcript -Path $logFile -Append -ErrorAction SilentlyContinue | Out-Null

@(
  $Root,
  (Join-Path $Root 'app'),
  $DatosDir,
  (Join-Path $Root 'respaldo')
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

# Siempre quitar arranque automatico legacy (no inicia panel ni tunel al encender la PC).
Remove-PanelAutoStartTasks

if ($SkipPanel) {
  Write-Host 'Panel web omitido: sin Node, cloudflared, archivos del panel ni puertos abiertos.' -ForegroundColor Cyan
  Write-Host 'Cuando lo necesite: Mantenimiento > Reactivar panel, o C:\Sanatorio\reparar-panel.cmd' -ForegroundColor Cyan
} else {
  @($PanelDir, $CloudDir, $NodeDir) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
  }

  Copy-PanelFromInstaller
  Ensure-Node

  $existing = if ($isUpgrade) { Read-ExistingPanelSecrets } else { $null }

  $syncSecret = if ($existing -and $existing.syncSecret) {
    $existing.syncSecret
  } else {
    New-RandomHex 24
  }

  $viewPassword = if ($existing -and $existing.viewPassword) {
    $existing.viewPassword
  } else {
    New-GerentePassword
  }

  Write-PanelEnvFile -SyncSecret $syncSecret -ViewPassword $viewPassword
  Install-PanelStartScript
  Install-TunnelStartScript
  Copy-PanelMaintenanceScripts

  $publicUrl = $null
  # Panel y tunel solo con "Reactivar panel" en Mantenimiento (o -RenewTunnel en reparacion manual).
  $shouldTunnel = (-not $SkipTunnel) -and $RenewTunnel.IsPresent
  if ($existing -and $existing.panelUrl) {
    $publicUrl = $existing.panelUrl
    if (-not $shouldTunnel) {
      Write-Host "Se conserva URL del panel: $publicUrl" -ForegroundColor Gray
      Write-Host 'Panel/tunel NO se inician solos. Use Mantenimiento > Reactivar panel.' -ForegroundColor Cyan
    }
  }

  if ($shouldTunnel) {
    $publicUrl = Start-QuickTunnelNow
  }

  if ($publicUrl) {
    Set-Content -Path $UrlFile -Value $publicUrl -Encoding UTF8
  } elseif ($isUpgrade -and (Test-Path $UrlFile)) {
    Write-Host 'Se conserva panel-url-publica.txt' -ForegroundColor Gray
  }

  Write-PanelConfigFile -PublicUrl $publicUrl -SyncSecret $syncSecret -ViewPassword $viewPassword `
    -PreserveSecrets:($isUpgrade)
  Write-PanelIntoDatos -PublicUrl $publicUrl -SyncSecret $syncSecret -ViewPassword $viewPassword `
    -PreserveSecrets:($isUpgrade)
}

Write-ShortcutScripts

Write-Host ''
if ($isUpgrade) {
  Write-Host 'Actualizacion completada. Datos y respaldos no fueron modificados.' -ForegroundColor Green
} else {
  Write-Host 'Instalacion en C:\Sanatorio completada.' -ForegroundColor Green
}
if ($SkipPanel) {
  Write-Host 'Panel web: configurelo despues desde la app (Mantenimiento > Reactivar panel).' -ForegroundColor Yellow
} elseif ($publicUrl) {
  Write-Host "URL gerente: $publicUrl" -ForegroundColor Cyan
} elseif (-not $isUpgrade) {
  Write-Host 'Active el panel desde la app: Mantenimiento > Reactivar panel.' -ForegroundColor Yellow
}
Write-Host "Config: $ConfigFile" -ForegroundColor Gray
Write-Host 'Datos: C:\Sanatorio\datos\' -ForegroundColor Gray
Write-Host ''
Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
