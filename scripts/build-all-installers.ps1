# Compila y genera los tres instaladores de Sanatorio: Server, Secretaria y Afiliados
param(
  [string]$DestDir = $PSScriptRoot + "\.."
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $ProjectRoot

try {
  Write-Host "=== Generando 3 Instaladores de Sanatorio v16.0.0 ===" -ForegroundColor Cyan

  Write-Host "`nSincronizando bases y credenciales para instaladores..." -ForegroundColor Yellow
  npm run installer:sync-bases
  if ($LASTEXITCODE -ne 0) { throw "Fallo la sincronizacion de bases del instalador" }

  # 1. Server
  Write-Host "`n[1/3] Compilando Sanatorio Server..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "server"
  npx tauri build -c src-tauri/tauri.server.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Server" }
  $srcServer = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Server_16.0.0_x64-setup.exe"
  Copy-Item $srcServer (Join-Path $DestDir "Sanatorio_Server_16.0.0.exe") -Force
  Copy-Item $srcServer (Join-Path $DestDir "Sanatorio_Server.exe") -Force
  Write-Host "Listo: Sanatorio_Server_16.0.0.exe" -ForegroundColor Green

  # 2. Secretaria
  Write-Host "`n[2/3] Compilando Sanatorio Secretaria..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "secretaria"
  npx tauri build -c src-tauri/tauri.secretaria.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Secretaria" }
  $srcSec = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Secretaria_16.0.0_x64-setup.exe"
  Copy-Item $srcSec (Join-Path $DestDir "Sanatorio_Secretaria_16.0.0.exe") -Force
  Copy-Item $srcSec (Join-Path $DestDir "Sanatorio_Secretaria.exe") -Force
  Write-Host "Listo: Sanatorio_Secretaria_16.0.0.exe" -ForegroundColor Green

  # 3. Afiliados
  Write-Host "`n[3/3] Compilando Sanatorio Afiliados..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "afiliados"
  npx tauri build -c src-tauri/tauri.afiliados.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Afiliados" }
  $srcAfil = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Afiliados_16.0.0_x64-setup.exe"
  Copy-Item $srcAfil (Join-Path $DestDir "Sanatorio_Afiliados_16.0.0.exe") -Force
  Copy-Item $srcAfil (Join-Path $DestDir "Sanatorio_Afiliados.exe") -Force
  Write-Host "Listo: Sanatorio_Afiliados_16.0.0.exe" -ForegroundColor Green

  Write-Host "`n=== Los 3 instaladores quedaron listos en $DestDir ===" -ForegroundColor Green
}
finally {
  Remove-Item Env:VITE_APP_FLAVOR -ErrorAction SilentlyContinue
  Pop-Location
}

