# Crea ZIP del código con System.IO.Compression (evita bloqueos de Compress-Archive en .ps1 copiados).
param(
  [string]$Version = '2.1.0',
  [string]$OutputDir = 'C:\Sanatorio',
  [int]$KeepMaxVersions = 2
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$ZipPath = Join-Path $OutputDir "Sanatorio-v$Version-codigo-limpio.zip"

$excludeDirNames = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@(
    'node_modules', 'target', 'gen', 'dist', 'dist-ssr', '.git', 'data',
    # Snapshot viejo del proyecto completo (1,3 GB). Sin excluirlo el ZIP sale
    # con dos copias del código y delata en qué estado estaba esa versión.
    '.tmp-sanatorio-v3.3.0-work',
    # Historial del asistente: no es código y pesa.
    '.codex-history', '.claude-code-history',
    # Andamiaje de builds y carpetas de trabajo sueltas.
    '_verify-installer', '_zip-staging', '_pkg'
  ),
  [StringComparer]::OrdinalIgnoreCase
)
$excludeDirPaths = @(
  (Join-Path $ProjectRoot '_zip-build-1.1.1'),
  (Join-Path $ProjectRoot '_zip-staging-1.1.1'),
  (Join-Path $ProjectRoot '_pkg-1.1.1'),
  (Join-Path $ProjectRoot '_zip-build-1.1.1')
)

function Test-ExcludedPath([string]$fullPath) {
  foreach ($seg in $fullPath.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) {
    if ($excludeDirNames.Contains($seg)) { return $true }
  }
  foreach ($p in $excludeDirPaths) {
    if ($fullPath.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

$emptyBasesDir = Join-Path $env:TEMP "Sanatorio-empty-bases-$Version"
if (Test-Path $emptyBasesDir) { Remove-Item $emptyBasesDir -Recurse -Force }
Write-Host "Generando bases vacías (temporal)..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot 'write-empty-installer-bases.mjs') $emptyBasesDir
$installerBasesRoot = (Join-Path $ProjectRoot 'src-tauri\installer-bases').ToLowerInvariant()

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = [System.IO.Directory]::EnumerateFiles($ProjectRoot, '*', [System.IO.SearchOption]::AllDirectories)
  foreach ($file in $files) {
    if (Test-ExcludedPath $file) { continue }
    $name = [IO.Path]::GetFileName($file)
    if ($name -like '*.zip' -or $name -eq '.env' -or $name.StartsWith('.env.')) { continue }
    # Logs de builds y corridas: no son código y llenan el ZIP de ruido.
    if ($name -like '*.log' -or $name -like '*.log.*') { continue }

    $rel = $file.Substring($ProjectRoot.Length).TrimStart('\', '/')
    $entryName = $rel.Replace('\', '/')
    $sourceFile = $file
    if ($file.ToLowerInvariant().StartsWith($installerBasesRoot)) {
      $baseRel = $file.Substring($installerBasesRoot.Length).TrimStart('\', '/')
      $fromEmpty = Join-Path $emptyBasesDir $baseRel
      if (Test-Path $fromEmpty) { $sourceFile = $fromEmpty }
    }
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $inStream = [System.IO.File]::Open($sourceFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $outStream = $entry.Open()
      try { $inStream.CopyTo($outStream) } finally { $outStream.Dispose() }
    } finally { $inStream.Dispose() }
  }

  $readme = @"
Centro Medico — Codigo fuente v$Version (limpio)
==============================================

Sin datos de clinica; installer-bases con JSON vacios.
Excluido: node_modules, dist, src-tauri/target, .git, *.zip

Version: $Version
Generado: $(Get-Date -Format 'yyyy-MM-dd HH:mm')
"@
  $readmeEntry = $zip.CreateEntry('LEEME-ZIP.txt')
  $sw = New-Object System.IO.StreamWriter($readmeEntry.Open())
  try { $sw.Write($readme) } finally { $sw.Dispose() }
} finally {
  $zip.Dispose()
}

$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host "Listo: $ZipPath ($sizeMb MB)" -ForegroundColor Green

$pattern = Join-Path $OutputDir 'Sanatorio-v*-codigo-limpio.zip'
$allZips = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending
if ($allZips.Count -gt $KeepMaxVersions) {
  $toRemove = $allZips | Select-Object -Skip $KeepMaxVersions
  foreach ($old in $toRemove) {
    Write-Host "Eliminando ZIP antiguo: $($old.Name)" -ForegroundColor Yellow
    Remove-Item $old.FullName -Force
  }
}
Write-Host "ZIPs conservados en ${OutputDir}: $KeepMaxVersions (mas recientes)." -ForegroundColor Green
