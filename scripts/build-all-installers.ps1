# Compila y genera los 3 instaladores de Sanatorio:
# 1. Server (Mesa de Entrada - Andrea y Mary / Servidor principal)
# 2. Administracion (Terminal cliente en red)
# 3. Afiliados (Terminal cliente en red)
param(
  [string]$DestDir = ""
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $DestDir) {
  $DestDir = $ProjectRoot
} else {
  $DestDir = (Resolve-Path $DestDir).Path
}

Push-Location $ProjectRoot

try {
  $appVer = "18.0.0"
  Write-Host "=== Generando Instaladores de Sanatorio v$appVer ===" -ForegroundColor Cyan

  Write-Host "`nSincronizando bases y credenciales para instaladores..." -ForegroundColor Yellow
  npm run installer:sync-bases
  if ($LASTEXITCODE -ne 0) { throw "Fallo la sincronizacion de bases del instalador" }

  # 1. Server (Mesa de Entrada - Andrea y Mary / Servidor principal)
  Write-Host "`n[1/3] Compilando Sanatorio Server (Mesa de Entrada)..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "server"
  npx tauri build -c src-tauri/tauri.server.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Server" }
  $srcServer = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Server_${appVer}_x64-setup.exe"
  Copy-Item $srcServer (Join-Path $DestDir "Sanatorio_Server_${appVer}.exe") -Force
  Write-Host "Listo: Sanatorio_Server_${appVer}.exe" -ForegroundColor Green

  # 2. Administracion (Terminal cliente en red)
  Write-Host "`n[2/3] Compilando Sanatorio Administracion..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "administrador"
  npx tauri build -c src-tauri/tauri.administrador.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Administracion" }
  $srcAdmin = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Administrador_${appVer}_x64-setup.exe"
  Copy-Item $srcAdmin (Join-Path $DestDir "Sanatorio_Administracion_${appVer}.exe") -Force
  Copy-Item $srcAdmin (Join-Path $DestDir "Sanatorio_Administrador_${appVer}.exe") -Force
  Write-Host "Listo: Sanatorio_Administracion_${appVer}.exe" -ForegroundColor Green

  # 3. Afiliados (Terminal cliente en red)
  Write-Host "`n[3/3] Compilando Sanatorio Afiliados..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "afiliados"
  npx tauri build -c src-tauri/tauri.afiliados.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Afiliados" }
  $srcAfil = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Afiliados_${appVer}_x64-setup.exe"
  Copy-Item $srcAfil (Join-Path $DestDir "Sanatorio_Afiliados_${appVer}.exe") -Force
  Write-Host "Listo: Sanatorio_Afiliados_${appVer}.exe" -ForegroundColor Green

  Write-Host "`n=== Los 3 instaladores quedaron listos en $DestDir ===" -ForegroundColor Green
}
finally {
  Remove-Item Env:VITE_APP_FLAVOR -ErrorAction SilentlyContinue
  Pop-Location
}
