$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot '..\src-tauri\installer-bases'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$datos = 'C:\Sanatorio\datos\sanatorio-datos.json'
$respaldo = 'C:\Sanatorio\respaldo'

if (-not (Test-Path $datos)) {
    $legacy = Join-Path $env:APPDATA 'com.sanatorio.gestion\sanatorio-datos.json'
    if (Test-Path $legacy) {
        $datos = $legacy
    } else {
        Write-Error "No se encontro la base en C:\Sanatorio\datos ni en AppData."
    }
}

Copy-Item $datos (Join-Path $dest 'sanatorio-datos.json') -Force
foreach ($n in 1..3) {
    $src = Join-Path $respaldo "sanatorio-datos.respaldo-$n.json"
    if (-not (Test-Path $src)) {
        Write-Error "Falta respaldo: $src"
    }
    Copy-Item $src (Join-Path $dest "sanatorio-datos.respaldo-$n.json") -Force
}

$auth = 'C:\Sanatorio\datos\auth-accounts.json'
if (Test-Path $auth) {
    Copy-Item $auth (Join-Path $dest 'auth-accounts.json') -Force
}

Write-Host "Bases listas en $dest"
