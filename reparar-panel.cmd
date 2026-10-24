@echo off
cd /d "%~dp0"
echo Reparando panel web Sanatorio (solo archivos; NO inicia puertos ni tunel)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\post-install.ps1" -AppDir "C:\Sanatorio\app" -Upgrade
echo.
echo Listo. Para activar panel y tunel: Mantenimiento ^> Reactivar panel (manual).
pause
