# Script de configuracion automatica para PC3 (Cliente) - Sanatorio
# Ejecutar en PC3 despues de configurar PC1
# (Identico a PC2: cualquier PC cliente puede usar este script)

Write-Host "=== Configuracion de PC3 (Cliente) - Sanatorio ===" -ForegroundColor Green

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

# Verificar HTTPS e /api/health con el certificado obtenido por un canal seguro
$tempCert = Join-Path $env:TEMP "sanatorio-server-cert-$PID.pem"
try {
    [System.IO.File]::WriteAllText($tempCert, $certPem, (New-Object System.Text.UTF8Encoding($false)))
    $null = & curl.exe --silent --show-error --fail --connect-timeout 4 --max-time 8 --cacert $tempCert "$apiUrl/api/health"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: HTTPS o /api/health no respondio con el certificado verificado. No se modifico la configuracion." -ForegroundColor Red
        exit 1
    }
} finally {
    Remove-Item -LiteralPath $tempCert -Force -ErrorAction SilentlyContinue
}

# 5. Guardar la configuracion verificada sin perder otros campos existentes
$configDir = "$env:APPDATA\Sanatorio"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$configFile = "$configDir\client-config.json"
$serverPrimaryIp = $null
$deviceId = [Guid]::NewGuid().ToString()
if (Test-Path -LiteralPath $configFile) {
    try {
        $previousConfig = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        $serverPrimaryIp = $previousConfig.serverPrimaryIp
        if ($previousConfig.deviceId) {
            $deviceId = $previousConfig.deviceId
        }
    } catch {
        Write-Host "Error: La configuracion existente no es valida; se conserva sin cambios." -ForegroundColor Red
        exit 1
    }
}
$config = [ordered]@{
    mode = "client"
    serverUrl = $apiUrl
    serverCertPem = $certPem
    serverPrimaryIp = $serverPrimaryIp
    deviceId = $deviceId
}
$json = $config | ConvertTo-Json -Depth 10
$tempConfig = "$configFile.$PID.tmp"
[System.IO.File]::WriteAllText($tempConfig, $json, (New-Object System.Text.UTF8Encoding($false)))
if (Test-Path -LiteralPath $configFile) {
    [System.IO.File]::Replace($tempConfig, $configFile, $null)
} else {
    [System.IO.File]::Move($tempConfig, $configFile)
}

Write-Host "Archivo de configuracion creado: $configFile" -ForegroundColor Green

# 5. Mostrar instrucciones
Write-Host "`n=== Configuracion completada ===" -ForegroundColor Green
Write-Host "1. Ejecuta la aplicacion Sanatorio" -ForegroundColor White
Write-Host "2. La app detectara automaticamente el modo cliente" -ForegroundColor White
Write-Host "3. Ingresa con tu usuario y contrasena" -ForegroundColor White
Write-Host "`nPara reconfigurar, usa el boton Configurar conexion antes del login o vuelve a ejecutar este script con el certificado del servidor." -ForegroundColor Yellow