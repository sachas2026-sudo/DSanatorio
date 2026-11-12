# Script de configuracion automatica para PC1 (Servidor) - Sanatorio
# Ejecutar como Administrador

Write-Host "=== Configuracion de PC1 (Servidor) - Sanatorio ===" -ForegroundColor Green

# 1. Obtener IP del servidor (Ethernet o Wi-Fi)
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet", "Wi-Fi" | Where-Object { $_.IPAddress -notlike "127.*" }).IPAddress
if (-not $ip) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }).IPAddress | Select-Object -First 1
}

if (-not $ip) {
    Write-Host "ERROR: No se pudo detectar la IP de red. Verifique la conexion Wi-Fi o cableada." -ForegroundColor Red
    exit 1
}

Write-Host "IP del servidor: $ip" -ForegroundColor Yellow

# 2. Configurar reglas de firewall limitadas al perfil privado y la subred local
Write-Host "Configurando Firewall..." -ForegroundColor Cyan
New-NetFirewallRule -DisplayName "Sanatorio API HTTPS" `
    -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow `
    -Profile Private -RemoteAddress LocalSubnet -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "Sanatorio Discovery UDP" `
    -Direction Inbound -Protocol UDP -LocalPort 8788 -Action Allow `
    -Profile Private -RemoteAddress LocalSubnet -ErrorAction SilentlyContinue | Out-Null

Write-Host "Firewall limitado a red local (TCP 8787 / UDP 8788, perfil Privado)" -ForegroundColor Green

# 3. Crear carpeta TLS y agregar la IP a names.txt
$tlsDir = "$env:APPDATA\Sanatorio\config\tls"
if (-not (Test-Path $tlsDir)) {
    New-Item -ItemType Directory -Path $tlsDir -Force | Out-Null
}

$namesFile = Join-Path $tlsDir "names.txt"
$names = @("localhost", "127.0.0.1", $ip)
$names | Out-File -FilePath $namesFile -Encoding UTF8

Write-Host "Archivo names.txt creado con: $($names -join ', ')" -ForegroundColor Green

# 4. Mostrar informacion de configuracion
Write-Host "`n=== Informacion de Configuracion ===" -ForegroundColor Green
Write-Host "IP del servidor: $ip" -ForegroundColor Yellow
Write-Host "URL para clientes: https://$ip`:8787" -ForegroundColor Yellow
Write-Host "`nPara iniciar el servidor:" -ForegroundColor Cyan
Write-Host "  Ejecutar la aplicacion Sanatorio en modo servidor" -ForegroundColor White
Write-Host "`nEl certificado TLS se generara automaticamente al iniciar." -ForegroundColor Cyan
Write-Host "El archivo server-cert.pem estara en: $tlsDir" -ForegroundColor White

# 5. Guardar IP en archivo para referencia
$ip | Out-File -FilePath "$env:APPDATA\Sanatorio\server-ip.txt" -Encoding UTF8
Write-Host "`nIP guardada en: $env:APPDATA\Sanatorio\server-ip.txt" -ForegroundColor Green

# 6. Instrucciones para los clientes
Write-Host "`n=== Instrucciones para PC2 y PC3 ===" -ForegroundColor Green
Write-Host "1. Copiar el archivo server-cert.pem de $tlsDir" -ForegroundColor White
Write-Host "2. En cada PC cliente, ejecutar configurar-pc2-cliente.ps1" -ForegroundColor White
Write-Host "3. Ingresar la IP del servidor: $ip" -ForegroundColor White
Write-Host "4. Pegar el contenido del certificado cuando se solicite" -ForegroundColor White

Write-Host "`n=== Configuracion completada ===" -ForegroundColor Green