# Compila y genera los instaladores de Sanatorio:
# 1. Server (Mesa de Entrada - Andrea y Mary / Servidor principal)
# 2. Administrador (Admi / Terminal cliente en red)
# 3. Afiliados (Afiliados / Terminal cliente en red)
param(
  [string]$DestDir = $PSScriptRoot + "\.."
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $ProjectRoot

try {
  Write-Host "=== Generando Instaladores de Sanatorio v16.0.0 ===" -ForegroundColor Cyan

  Write-Host "`nSincronizando bases y credenciales para instaladores..." -ForegroundColor Yellow
  npm run installer:sync-bases
  if ($LASTEXITCODE -ne 0) { throw "Fallo la sincronizacion de bases del instalador" }

  # 1. Server (Mesa de Entrada - Andrea y Mary)
  Write-Host "`n[1/3] Compilando Sanatorio Server (Mesa de Entrada)..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "server"
  npx tauri build -c src-tauri/tauri.server.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Server" }
  $srcServer = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Server_16.0.0_x64-setup.exe"
  Copy-Item $srcServer (Join-Path $DestDir "Sanatorio_Server_16.0.0.exe") -Force
  Copy-Item $srcServer (Join-Path $DestDir "Sanatorio_Server.exe") -Force
  Copy-Item $srcServer (Join-Path $DestDir "Sanatorio_Secretaria.exe") -Force
  Write-Host "Listo: Sanatorio_Server_16.0.0.exe (y Sanatorio_Secretaria.exe)" -ForegroundColor Green

  # 2. Administrador (Admi)
  Write-Host "`n[2/3] Compilando Sanatorio Administrador (Admi)..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "administrador"
  npx tauri build -c src-tauri/tauri.administrador.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Administrador" }
  $srcAdmin = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Administrador_16.0.0_x64-setup.exe"
  Copy-Item $srcAdmin (Join-Path $DestDir "Sanatorio_Administrador_16.0.0.exe") -Force
  Copy-Item $srcAdmin (Join-Path $DestDir "Sanatorio_Administrador.exe") -Force
  Copy-Item $srcAdmin (Join-Path $DestDir "Sanatorio_Admi.exe") -Force
  Write-Host "Listo: Sanatorio_Administrador_16.0.0.exe (y Sanatorio_Admi.exe)" -ForegroundColor Green

  # 3. Afiliados
  Write-Host "`n[3/3] Compilando Sanatorio Afiliados..." -ForegroundColor Yellow
  $env:VITE_APP_FLAVOR = "afiliados"
  npx tauri build -c src-tauri/tauri.afiliados.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de Sanatorio Afiliados" }
  $srcAfil = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Sanatorio Afiliados_16.0.0_x64-setup.exe"
  Copy-Item $srcAfil (Join-Path $DestDir "Sanatorio_Afiliados_16.0.0.exe") -Force
  Copy-Item $srcAfil (Join-Path $DestDir "Sanatorio_Afiliados.exe") -Force
  Write-Host "Listo: Sanatorio_Afiliados_16.0.0.exe" -ForegroundColor Green

  Write-Host "`n=== Todos los instaladores quedaron listos en $DestDir ===" -ForegroundColor Green
}
finally {
  Remove-Item Env:VITE_APP_FLAVOR -ErrorAction SilentlyContinue
  Pop-Location
}
