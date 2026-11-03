# Script de configuracion automatica para PC2 (Cliente) - Sanatorio
# Ejecutar en PC2 despues de configurar PC1

Write-Host "=== Configuracion de PC2 (Cliente) - Sanatorio ===" -ForegroundColor Green

# 1. Solicitar IP del servidor
$serverIp = Read-Host "Ingresa la IP del servidor (PC1). Ejemplo: 192.168.1.100"

if (-not $serverIp) {
    Write-Host "Error: Debes ingresar una IP del servidor" -ForegroundColor Red
    exit 1
}

# Validar formato de IP
$ipPattern = "^(\d{1,3}\.){3}\d{1,3}$"
if ($serverIp -notmatch $ipPattern) {
    Write-Host "Error: Formato de IP invalido. Ejemplo: 192.168.1.100" -ForegroundColor Red
    exit 1
}

Write-Host "IP del servidor: $serverIp" -ForegroundColor Yellow

# 2. Configurar URL del servidor
$apiUrl = "https://${serverIp}:8787"
Write-Host "URL del servidor: $apiUrl" -ForegroundColor Yellow

# 3. Solicitar el certificado del servidor
Write-Host "`n=== Certificado del servidor ===" -ForegroundColor Cyan
Write-Host "Copia el contenido del archivo server-cert.pem del servidor." -ForegroundColor White
Write-Host "Pegalo aqui (termina con una linea vacia):" -ForegroundColor White

$certLines = @()
while ($true) {
    $line = Read-Host
    if ($line -eq "") { break }
    $certLines += $line
}
$certPem = $certLines -join "`n"

if (-not $certPem.Contains("-----BEGIN CERTIFICATE-----")) {
    Write-Host "Error: El certificado no tiene formato PEM valido" -ForegroundColor Red
    exit 1
}

# 4. Crear archivo de configuracion del cliente
$configDir = "$env:APPDATA\Sanatorio"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$configFile = "$configDir\client-config.json"
# La app (serde camelCase) espera serverUrl / serverCertPem.
# Se escribe UTF-8 sin BOM y reemplazando el archivo completo.
$config = [ordered]@{
    mode = "client"
    serverUrl = $apiUrl
    serverCertPem = $certPem
}
$json = $config | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($configFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Archivo de configuracion creado: $configFile" -ForegroundColor Green

# 5. Mostrar instrucciones
Write-Host "`n=== Configuracion completada ===" -ForegroundColor Green
Write-Host "1. Ejecuta la aplicacion Sanatorio" -ForegroundColor White
Write-Host "2. La app detectara automaticamente el modo cliente" -ForegroundColor White
Write-Host "3. Ingresa con tu usuario y contrasena" -ForegroundColor White
Write-Host "`nSi necesitas reconfigurar, borra: $configFile" -ForegroundColor Yellow