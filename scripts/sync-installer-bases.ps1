$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot '..\src-tauri\installer-bases'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$appdata = Join-Path $env:APPDATA 'com.sanatorio.gestion\sanatorio-datos.json'
$respaldo = 'C:\Sanatorio\respaldo'

if (-not (Test-Path $appdata)) {
    Write-Error "No se encontró la base en uso: $appdata"
}

Copy-Item $appdata (Join-Path $dest 'sanatorio-datos.json') -Force
foreach ($n in 1..3) {
    $src = Join-Path $respaldo "sanatorio-datos.respaldo-$n.json"
    if (-not (Test-Path $src)) {
        Write-Error "Falta respaldo: $src"
    }
    Copy-Item $src (Join-Path $dest "sanatorio-datos.respaldo-$n.json") -Force
}

Write-Host "Bases listas en $dest"
