# Detiene panel local (node) y tunel Cloudflare. No toca la app de escritorio.
$ErrorActionPreference = 'SilentlyContinue'

. "$PSScriptRoot\panel-autostart-task-names.ps1"
Stop-PanelAutoStartScheduledTasks

Start-Sleep -Seconds 1

Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object {
    $cmd = $_.CommandLine
    $cmd -and ($cmd -match 'panel\.cjs' -or $cmd -match '\\Sanatorio\\panel\\')
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
