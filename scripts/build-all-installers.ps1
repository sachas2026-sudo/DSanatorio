# Compila un único instalador de Sanatorio que permite elegir el perfil de cada PC.
param(
  [string]$DestDir = ""
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $DestDir) {
  $DestDir = $ProjectRoot
} else {
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
  $DestDir = (Resolve-Path $DestDir).Path
}

Push-Location $ProjectRoot

$seedDir = Join-Path $ProjectRoot "src-tauri\installer-bases"
$seedFiles = @(
  "sanatorio-datos.json",
  "sanatorio-datos.respaldo-1.json",
  "sanatorio-datos.respaldo-2.json",
  "sanatorio-datos.respaldo-3.json",
  "auth-accounts.json"
)
$seedBackup = Join-Path $env:TEMP ("Sanatorio-installer-seeds-" + [guid]::NewGuid().ToString("N"))
$seedExisted = @{}

try {
  New-Item -ItemType Directory -Force -Path $seedBackup | Out-Null
  foreach ($name in $seedFiles) {
    $source = Join-Path $seedDir $name
    $seedExisted[$name] = Test-Path -LiteralPath $source
    if ($seedExisted[$name]) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $seedBackup $name)
    }
  }

  $pkg = Get-Content (Join-Path $ProjectRoot "package.json") | ConvertFrom-Json
  $appVer = $pkg.version
  Write-Host "=== Generando instalador unico de Sanatorio v$appVer ===" -ForegroundColor Cyan

  Write-Host "`nPreparando semillas vacias y cuentas iniciales..." -ForegroundColor Yellow
  node (Join-Path $ProjectRoot "scripts\write-empty-installer-bases.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Fallo la preparacion de semillas vacias" }

  Remove-Item Env:VITE_APP_FLAVOR -ErrorAction SilentlyContinue
  Write-Host "`nCompilando instalador unico..." -ForegroundColor Yellow
  npx tauri build
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion del instalador unico" }
  $srcInstaller = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio V_${appVer}_x64-setup.exe"
  $installerName = "Sanatorio_Instalador_V${appVer}.exe"
  Copy-Item $srcInstaller (Join-Path $DestDir $installerName) -Force
  Write-Host "Listo: $installerName" -ForegroundColor Green
  Write-Host "`n=== El instalador unico quedo listo en $DestDir ===" -ForegroundColor Green
}
finally {
  Remove-Item Env:VITE_APP_FLAVOR -ErrorAction SilentlyContinue
  foreach ($name in $seedFiles) {
    $destination = Join-Path $seedDir $name
    if ($seedExisted.ContainsKey($name) -and $seedExisted[$name]) {
      Copy-Item -LiteralPath (Join-Path $seedBackup $name) -Destination $destination -Force
    } elseif (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Force
    }
  }
  if (Test-Path -LiteralPath $seedBackup) {
    Remove-Item -LiteralPath $seedBackup -Recurse -Force
  }
  Pop-Location
}
