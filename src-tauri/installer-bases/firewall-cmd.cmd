@echo off
chcp 65001 >nul 2>&1

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: no se dispone de privilegios de administrador. Ejecute como administrador.
  pause
  exit /b 1
)

set LOG=C:\Sanatorio\firewall-setup.log
if exist "%LOG%" (
  echo. >> "%LOG%"
  echo == %date% %time% == >> "%LOG%"
) else (
  echo == %date% %time% == > "%LOG%"
)

netsh advfirewall firewall delete rule name="Sanatorio Server" >> "%LOG%" 2>&1
netsh advfirewall firewall delete rule name="Sanatorio Discovery" >> "%LOG%" 2>&1
netsh advfirewall firewall delete rule name="Sanatorio App" >> "%LOG%" 2>&1
netsh advfirewall firewall add rule name="Sanatorio Server" dir=in action=allow protocol=TCP localport=8787 profile=any >> "%LOG%" 2>&1
netsh advfirewall firewall add rule name="Sanatorio Discovery" dir=in action=allow protocol=UDP localport=8788 profile=any >> "%LOG%" 2>&1
netsh advfirewall firewall add rule name="Sanatorio App" dir=in action=allow program="C:\Sanatorio\app\app.exe" profile=any >> "%LOG%" 2>&1

echo Puertos TCP 8787 / UDP 8788 abiertos. Se actualizo "%LOG%" >> "%LOG%"
echo. >> "%LOG%"
echo Guarde "%LOG%" para ver los detalles si algo bloquea la conexion.
pause
exit /b 0
