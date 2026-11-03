; Instalacion en C:\Sanatorio — programa y datos.

!macro StopSanatorioProcesses
  nsExec::ExecToLog 'cmd /c schtasks /End /TN SanatorioPanel 2>nul'
  nsExec::ExecToLog 'cmd /c schtasks /End /TN SanatorioPanelTunnel 2>nul'
  nsExec::ExecToLog 'cmd /c schtasks /End /TN CuidarPanel 2>nul'
  nsExec::ExecToLog 'cmd /c schtasks /End /TN CuidarPanelTunnel 2>nul'
  Sleep 1500
  nsExec::ExecToLog 'cmd /c taskkill /F /IM app.exe /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM cloudflared.exe /T 2>nul'
  nsExec::ExecToLog 'cmd /c wmic process where "name=''node.exe'' and CommandLine like ''%panel.cjs%''" call terminate 2>nul'
  nsExec::ExecToLog 'cmd /c wmic process where "CommandLine like ''%iniciar-panel.cmd%''" call terminate 2>nul'
  Sleep 1500
!macroend

!macro CleanupLegacyProgramFiles
  ReadEnvStr $R5 ProgramW6432
  StrCmp $R5 "" +2 0
    ExecWait 'cmd /c if exist "$R5\Centro Medico\panel" rmdir /S /Q "$R5\Centro Medico\panel"' $0
  ReadEnvStr $R6 ProgramFiles
  StrCmp $R6 "" +2 0
    ExecWait 'cmd /c if exist "$R6\Centro Medico\panel" rmdir /S /Q "$R6\Centro Medico\panel"' $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro StopSanatorioProcesses
  !insertmacro CleanupLegacyProgramFiles

  ; Tauri hace SetOutPath antes del hook; hay que re-aplicar tras cambiar $INSTDIR
  StrCpy $INSTDIR "C:\Sanatorio\app"
  CreateDirectory "C:\Sanatorio\app"
  SetOutPath $INSTDIR
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro StopSanatorioProcesses
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "C:\Sanatorio\datos"
  CreateDirectory "C:\Sanatorio\respaldo"

  ; Si ya hay base SQLite o JSON en la PC, no copiar semillas del instalador
  IfFileExists "C:\Sanatorio\datos\sanatorio-datos.db" SkipSeedData 0
  IfFileExists "C:\Sanatorio\datos\sanatorio-datos.json" SkipSeedData 0

  ; Tauri 2 coloca recursos junto al .exe (no siempre en resources\)
  IfFileExists "$INSTDIR\sanatorio-datos.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\sanatorio-datos.json" "C:\Sanatorio\datos\"

  IfFileExists "$INSTDIR\resources\sanatorio-datos.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.json" "C:\Sanatorio\datos\"

  IfFileExists "$INSTDIR\sanatorio-datos.respaldo-1.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\sanatorio-datos.respaldo-1.json" "C:\Sanatorio\respaldo\"

  IfFileExists "$INSTDIR\resources\sanatorio-datos.respaldo-1.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.respaldo-1.json" "C:\Sanatorio\respaldo\"

  IfFileExists "$INSTDIR\sanatorio-datos.respaldo-2.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\sanatorio-datos.respaldo-2.json" "C:\Sanatorio\respaldo\"

  IfFileExists "$INSTDIR\resources\sanatorio-datos.respaldo-2.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.respaldo-2.json" "C:\Sanatorio\respaldo\"

  IfFileExists "$INSTDIR\sanatorio-datos.respaldo-3.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\sanatorio-datos.respaldo-3.json" "C:\Sanatorio\respaldo\"

  IfFileExists "$INSTDIR\resources\sanatorio-datos.respaldo-3.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.respaldo-3.json" "C:\Sanatorio\respaldo\"

SkipSeedData:
  ; La base vive en C:\Sanatorio\datos — no duplicar junto al .exe
  Delete "$INSTDIR\sanatorio-datos.json"
  Delete "$INSTDIR\sanatorio-datos.respaldo-1.json"
  Delete "$INSTDIR\sanatorio-datos.respaldo-2.json"
  Delete "$INSTDIR\sanatorio-datos.respaldo-3.json"
  Delete "$INSTDIR\resources\sanatorio-datos.json"
  Delete "$INSTDIR\resources\sanatorio-datos.respaldo-1.json"
  Delete "$INSTDIR\resources\sanatorio-datos.respaldo-2.json"
  Delete "$INSTDIR\resources\sanatorio-datos.respaldo-3.json"

  ; Si no existen cuentas de usuario, copiar auth-accounts.json semilla
  IfFileExists "C:\Sanatorio\datos\auth-accounts.json" SkipSeedAuth 0

  IfFileExists "$INSTDIR\auth-accounts.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\auth-accounts.json" "C:\Sanatorio\datos\"

  IfFileExists "$INSTDIR\resources\auth-accounts.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\auth-accounts.json" "C:\Sanatorio\datos\"

SkipSeedAuth:
  Delete "$INSTDIR\auth-accounts.json"
  Delete "$INSTDIR\resources\auth-accounts.json"

  FileOpen $9 "C:\Sanatorio\Abrir Centro Medico.cmd" w
  FileWrite $9 "@echo off$\r$\n"
  FileWrite $9 "start $\"$\" $\"$INSTDIR\app.exe$\"$\r$\n"
  FileClose $9

  FileOpen $9 "C:\Sanatorio\LEEME-ACTUALIZACION.txt" w
  FileWrite $9 "Centro Medico — Actualizar sin perder datos$\r$\n"
  FileWrite $9 "================================================$\r$\n"
  FileWrite $9 "Datos: C:\Sanatorio\datos\$\r$\n"
  FileWrite $9 "Respaldo: C:\Sanatorio\respaldo\$\r$\n"
  FileWrite $9 "Programa: C:\Sanatorio\app\$\r$\n"
  FileWrite $9 "$\r$\n"
  FileWrite $9 "Ejecute el instalador nuevo sobre la instalacion actual.$\r$\n"
  FileWrite $9 "No desinstale antes: solo se actualiza el programa.$\r$\n"
  FileWrite $9 "$\r$\n"
  FileWrite $9 "Si tenia una version en Program Files, puede desinstalarla desde$\r$\n"
  FileWrite $9 "Configuracion de Windows (la app nueva queda en C:\Sanatorio\app).$\r$\n"
  FileClose $9

  ; Esta distribución es solo de actualización de código: no dejar
  ; ejecutable ni acceso de desinstalación en la PC instalada.
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\Sanatorio\Uninstall Centro Medico.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Centro Medico"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.sanatorio.gestion_is1"

  !insertmacro StopSanatorioProcesses
!macroend
