@echo off
echo Reparando panel web Sanatorio...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Sanatorio\app\post-install.ps1" -AppDir "C:\Sanatorio\app"
echo.
echo Listo. En la app: Mantenimiento ^> Reactivar panel (no se abre solo al instalar).
pause
