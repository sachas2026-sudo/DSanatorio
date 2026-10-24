param(
  [string]$Version = '11.0.0',
  [string]$OutputDir = 'E:\Proyectos\Sanatorio'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ZipPath = Join-Path $OutputDir "Version $Version.zip"

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

$excludeDirNames = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@('node_modules', 'target', 'gen', 'dist', 'dist-ssr', '.git', 'data', '.claude-code-history', '.codex-history', '.tmp-sanatorio-v3.3.0-work', 'backups', 'cargo-wrapper', 'npx-wrapper'),
  [StringComparer]::OrdinalIgnoreCase
)

function Test-ExcludedPath([string]$fullPath) {
  foreach ($seg in $fullPath.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) {
    if ($excludeDirNames.Contains($seg)) { return $true }
  }
  return $false
}

$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = [System.IO.Directory]::EnumerateFiles($ProjectRoot, '*', [System.IO.SearchOption]::AllDirectories)
  $count = 0
  foreach ($file in $files) {
    if (Test-ExcludedPath $file) { continue }
    $name = [IO.Path]::GetFileName($file)
    if ($name -like '*.zip' -or $name -eq '.env' -or $name.StartsWith('.env.') -or $name -like '*.pdb') { continue }
    if ($name -in @('hello.exe', 'test.exe', 'tauri-dev-log.txt')) { continue }

    $rel = $file.Substring($ProjectRoot.Length).TrimStart('\', '/')
    $entryName = $rel.Replace('\', '/')
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $inStream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $outStream = $entry.Open()
      try { $inStream.CopyTo($outStream) } finally { $outStream.Dispose() }
    } finally { $inStream.Dispose() }
    $count++
  }
  Write-Host "Archivos incluidos: $count" -ForegroundColor Cyan
} finally {
  $zip.Dispose()
}

$fileItem = Get-Item $ZipPath
$sizeMb = [math]::Round($fileItem.Length / 1MB, 2)
Write-Host "ZIP creado exitosamente: $ZipPath ($sizeMb MB)" -ForegroundColor Green
