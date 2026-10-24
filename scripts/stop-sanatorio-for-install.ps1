# Detiene la app antes de instalar/actualizar.

$ErrorActionPreference = 'SilentlyContinue'



Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue

Stop-Process -Name app -Force -ErrorAction SilentlyContinue



Start-Sleep -Seconds 2

