# Empaqueta el código fuente en ZIP (sin node_modules, sin datos reales).
# Uso: powershell -File scripts/package-source-zip.ps1 [-Version 2.1.0] [-OutputDir C:\Sanatorio]

param(
  [string]$Version = '2.1.0',
  [string]$OutputDir = 'C:\Sanatorio',
  [int]$KeepMaxVersions = 2
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'zip-source-dotnet.ps1') -Version $Version -OutputDir $OutputDir -KeepMaxVersions $KeepMaxVersions
