# Copia el instalador NSIS generado por Tauri a una carpeta destino.
param(
  [string]$Version = '9.0.0',
  [string]$DestDir = 'C:\Proyectos\Instaladores',
  [switch]$Actualizacion
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BundleDir = Join-Path $ProjectRoot 'src-tauri\target\release\bundle\nsis'

if (-not (Test-Path $BundleDir)) {
  throw "No hay instalador compilado en $BundleDir. Ejecute: npm run installer:build-clean"
}

$exe = Get-ChildItem -Path $BundleDir -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) {
  throw "No se encontró .exe en $BundleDir"
}

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$suffix = if ($Actualizacion) { 'actualizacion-codigo' } else { 'instalador-limpio' }
$destName = "Centro-Medico-v$Version-$suffix.exe"
$destPath = Join-Path $DestDir $destName

Copy-Item -Path $exe.FullName -Destination $destPath -Force

$tipo = if ($Actualizacion) {
  'actualizacion de codigo (conserva datos en la PC)'
} else {
  'instalador limpio (bases vacias en maquina nueva)'
}

$readme = @"
Centro Medico v$Version — $tipo
=========================================

ANTES DE INSTALAR:
1. Cierre la app Centro Medico si esta abierta.
2. Ejecute este .exe con clic derecho -> Ejecutar como administrador.
3. No desinstale antes: el asistente actualiza C:\Sanatorio\app\.

DATOS EN LA PC (no se reemplazan si ya existen):
- C:\Sanatorio\datos\sanatorio-datos.db   base principal (SQLite)
- C:\Sanatorio\datos\sanatorio-datos.json  (solo si no hay base previa)
- C:\Sanatorio\respaldo\  copias de seguridad

PROGRAMA:
- C:\Sanatorio\app\

Archivo: $destName
Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm')
"@

Set-Content -Path (Join-Path $DestDir "LEEME-INSTALADOR-v$Version.txt") -Value $readme -Encoding UTF8

Write-Host "Instalador: $destPath" -ForegroundColor Green
Write-Host "Tamaño: $([math]::Round((Get-Item $destPath).Length / 1MB, 2)) MB" -ForegroundColor Gray
