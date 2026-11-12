; Instalacion en C:\Sanatorio — programa y datos.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var InstallProfile
Var InstallServerRadio
Var InstallContractorsRadio
Var InstallAdminRadio
Var InstallClientModeControl
Var InstallClientHostControl
Var InstallClientPortControl
Var InstallClientHost
Var InstallClientPort
Var InstallServerUrl

Page custom InstallProfilePage InstallProfilePageLeave
Page custom InstallClientNetworkPage InstallClientNetworkPageLeave

Function InstallProfilePage
  IfSilent 0 +2
    Abort "Ejecute el instalador de forma interactiva para elegir Servidor o Cliente."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 28u "Seleccione el tipo de instalación. Solo las opciones Cliente pedirán la dirección del servidor."
  Pop $1
  ${NSD_CreateFirstRadioButton} 0 38u 100% 20u "Servidor — esta PC aloja la API LAN (TCP 8787)."
  Pop $InstallServerRadio
  ${NSD_CreateAdditionalRadioButton} 0 62u 100% 20u "Cliente — Contratantes (PC2)."
  Pop $InstallContractorsRadio
  ${NSD_CreateAdditionalRadioButton} 0 86u 100% 20u "Cliente — Administración (PC3)."
  Pop $InstallAdminRadio
  ${NSD_Uncheck} $InstallServerRadio
  ${NSD_Uncheck} $InstallContractorsRadio
  ${NSD_Uncheck} $InstallAdminRadio
  nsDialogs::Show
FunctionEnd

Function InstallProfilePageLeave
  ${NSD_GetState} $InstallServerRadio $0
  ${NSD_GetState} $InstallContractorsRadio $1
  ${NSD_GetState} $InstallAdminRadio $2
  ${If} $0 == 1
    StrCpy $InstallProfile "server"
  ${ElseIf} $1 == 1
    StrCpy $InstallProfile "contratantes"
  ${ElseIf} $2 == 1
    StrCpy $InstallProfile "administracion"
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Debe elegir Servidor o una opción Cliente para continuar."
    Abort
  ${EndIf}
FunctionEnd

Function InstallClientNetworkPage
  IfSilent 0 +2
    Abort "Ejecute el instalador de forma interactiva para configurar el Cliente."
  ${If} $InstallProfile == "server"
    Abort
  ${EndIf}
  IfFileExists "$APPDATA\Sanatorio\client-config.json" ExistingClientNetworkConfig

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30u "Configure la conexión LAN del cliente. La búsqueda UDP es opcional; también puede ingresar la dirección HTTPS manualmente."
  Pop $1
  ${NSD_CreateDropList} 0 38u 100% 16u ""
  Pop $InstallClientModeControl
  ${NSD_CB_AddString} $InstallClientModeControl "Buscar automáticamente al iniciar (UDP 8788)"
  ${NSD_CB_AddString} $InstallClientModeControl "Ingresar IP y puerto HTTPS"
  ${NSD_CB_SelectString} $InstallClientModeControl "Buscar automáticamente al iniciar (UDP 8788)"
  ${NSD_CreateLabel} 0 68u 100% 18u "IP del servidor:"
  Pop $1
  ${NSD_CreateText} 0 86u 68% 14u ""
  Pop $InstallClientHostControl
  ${NSD_CreateLabel} 70% 68u 30% 18u "Puerto HTTPS:"
  Pop $1
  ${NSD_CreateText} 70% 86u 30% 14u "8787"
  Pop $InstallClientPortControl
  nsDialogs::Show
ExistingClientNetworkConfig:
  Abort

FunctionEnd

Function InstallClientNetworkPageLeave
  IfSilent ClientNetworkPageDone
  ${If} $InstallProfile == "server"
    StrCpy $InstallServerUrl ""
    Return
  ${EndIf}
  IfFileExists "$APPDATA\Sanatorio\client-config.json" ClientNetworkPageDone

  ${NSD_GetText} $InstallClientModeControl $0
  ${If} $0 != "Ingresar IP y puerto HTTPS"
    StrCpy $InstallServerUrl ""
    Return
  ${EndIf}
  ${NSD_GetText} $InstallClientHostControl $InstallClientHost
  ${NSD_GetText} $InstallClientPortControl $InstallClientPort
  StrLen $1 $InstallClientHost
  ${If} $1 < 7
  ${OrIf} $1 > 15
    MessageBox MB_ICONEXCLAMATION|MB_OK "Ingrese una dirección IPv4 válida."
    Abort
  ${EndIf}
  StrLen $1 $InstallClientPort
  ${If} $1 < 1
  ${OrIf} $1 > 5
    MessageBox MB_ICONEXCLAMATION|MB_OK "Ingrese un puerto entre 1 y 65535."
    Abort
  ${EndIf}

  StrCpy $2 0
  StrCpy $3 0
  StrCpy $5 0
  StrCpy $6 0
ClientHostLoop:
  StrLen $1 $InstallClientHost
  IntCmp $2 $1 ClientHostDone
  StrCpy $4 $InstallClientHost 1 $2
  StrCmp $4 "." ClientHostDot
  StrCmp $4 "0" ClientHostDigit
  StrCmp $4 "1" ClientHostDigit
  StrCmp $4 "2" ClientHostDigit
  StrCmp $4 "3" ClientHostDigit
  StrCmp $4 "4" ClientHostDigit
  StrCmp $4 "5" ClientHostDigit
  StrCmp $4 "6" ClientHostDigit
  StrCmp $4 "7" ClientHostDigit
  StrCmp $4 "8" ClientHostDigit
  StrCmp $4 "9" ClientHostDigit
  Goto ClientHostInvalid
ClientHostDot:
  ${If} $6 == 0
    Goto ClientHostInvalid
  ${EndIf}
  ${If} $5 > 255
    Goto ClientHostInvalid
  ${EndIf}
  IntOp $3 $3 + 1
  StrCpy $5 0
  StrCpy $6 0
  Goto ClientHostNext
ClientHostDigit:
  IntOp $5 $5 * 10
  IntOp $4 $4 - 0
  IntOp $5 $5 + $4
  IntOp $6 $6 + 1
  ${If} $6 > 3
    Goto ClientHostInvalid
  ${EndIf}
  ${If} $5 > 255
    Goto ClientHostInvalid
  ${EndIf}
  Goto ClientHostNext
ClientHostNext:
  IntOp $2 $2 + 1
  Goto ClientHostLoop
ClientHostDone:
  ${If} $3 != 3
  ${OrIf} $6 == 0
  ${OrIf} $5 > 255
    Goto ClientHostInvalid
  ${EndIf}
  StrCpy $2 0
  StrCpy $3 0
ClientPortLoop:
  StrLen $1 $InstallClientPort
  IntCmp $2 $1 ClientPortDone
  StrCpy $4 $InstallClientPort 1 $2
  StrCmp $4 "0" ClientPortNext
  StrCmp $4 "1" ClientPortNext
  StrCmp $4 "2" ClientPortNext
  StrCmp $4 "3" ClientPortNext
  StrCmp $4 "4" ClientPortNext
  StrCmp $4 "5" ClientPortNext
  StrCmp $4 "6" ClientPortNext
  StrCmp $4 "7" ClientPortNext
  StrCmp $4 "8" ClientPortNext
  StrCmp $4 "9" ClientPortNext
  Goto ClientPortInvalid
ClientPortNext:
  IntOp $2 $2 + 1
  Goto ClientPortLoop
ClientPortDone:
  IntOp $5 $InstallClientPort + 0
  IntCmp $5 1 ClientPortStore ClientPortInvalid ClientPortRangeCheck
ClientPortRangeCheck:
  IntCmp $5 65535 ClientPortStore ClientPortStore ClientPortInvalid
  StrCpy $InstallServerUrl "https://$InstallClientHost:$InstallClientPort"
  Goto ClientNetworkPageDone
ClientHostInvalid:
  MessageBox MB_ICONEXCLAMATION|MB_OK "La dirección debe contener una IPv4 válida."
  Abort
ClientPortInvalid:
  MessageBox MB_ICONEXCLAMATION|MB_OK "El puerto debe ser numérico y estar entre 1 y 65535."
  Abort
ClientPortStore:
  StrCpy $InstallServerUrl "https://$InstallClientHost:$InstallClientPort"
ClientNetworkPageDone:
FunctionEnd

!macro StopSanatorioProcesses
  nsExec::ExecToLog 'cmd /c schtasks /End /TN SanatorioPanel 2>nul'
  Pop $0
  nsExec::ExecToLog 'cmd /c schtasks /End /TN SanatorioPanelTunnel 2>nul'
  Pop $0
  nsExec::ExecToLog 'cmd /c schtasks /End /TN CuidarPanel 2>nul'
  Pop $0
  nsExec::ExecToLog 'cmd /c schtasks /End /TN CuidarPanelTunnel 2>nul'
  Pop $0
  Sleep 1500
  nsExec::ExecToLog 'cmd /c taskkill /F /IM app.exe /T 2>nul'
  Pop $0
  nsExec::ExecToLog 'cmd /c taskkill /F /IM cloudflared.exe /T 2>nul'
  Pop $0
  nsExec::ExecToLog 'cmd /c wmic process where "name=''node.exe'' and CommandLine like ''%panel.cjs%''" call terminate 2>nul'
  Pop $0
  nsExec::ExecToLog 'cmd /c wmic process where "CommandLine like ''%iniciar-panel.cmd%''" call terminate 2>nul'
  Pop $0
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
  IfSilent 0 +2
    Abort "La instalación requiere modo interactivo para seleccionar Servidor o Cliente."
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
  ; Conservar el perfil seleccionado por PC; el modo cliente/servidor se fija al iniciar.
  CreateDirectory "C:\Sanatorio"
  ${If} $InstallProfile == ""
    ReadINIStr $InstallProfile "C:\Sanatorio\install-profile.ini" "Sanatorio" "Profile"
  ${EndIf}
  ${If} $InstallProfile == ""
    StrCpy $InstallProfile "server"
  ${EndIf}
  WriteINIStr "C:\Sanatorio\install-profile.ini" "Sanatorio" "Profile" "$InstallProfile"

  ${If} $InstallProfile != "server"
    IfFileExists "$APPDATA\Sanatorio\client-config.json" SkipInitialClientConfig
    CreateDirectory "$APPDATA\Sanatorio"
    ClearErrors
    FileOpen $9 "$APPDATA\Sanatorio\client-config.json" w
    IfErrors SkipInitialClientConfig
    ${If} $InstallServerUrl == ""
      FileWrite $9 "$\r$\n{$\"mode$\":$\"client$\",$\"serverUrl$\":null,$\"serverCertPem$\":null,$\"serverPrimaryIp$\":null}$\r$\n"
    ${Else}
      FileWrite $9 "$\r$\n{$\"mode$\":$\"client$\",$\"serverUrl$\":$\"$InstallServerUrl$\",$\"serverCertPem$\":null,$\"serverPrimaryIp$\":null}$\r$\n"
    ${EndIf}
    FileClose $9
SkipInitialClientConfig:
  ${EndIf}

  ; Permitir escritura solo en el archivo de diagnóstico, no en la carpeta de instalación.
  ClearErrors
  FileOpen $9 "$INSTDIR\Erroes.log" a
  IfErrors SkipErroesLogAcl
  FileClose $9
  nsExec::ExecToLog 'cmd /c icacls "$INSTDIR\Erroes.log" /grant "*S-1-5-32-545:(W)"'
  Pop $0
SkipErroesLogAcl:
  FileOpen $9 "$INSTDIR\Transacciones.txt" a
  IfErrors SkipTransactionLogAcl
  FileClose $9
  nsExec::ExecToLog 'cmd /c icacls "$INSTDIR\Transacciones.txt" /grant "*S-1-5-32-545:(W)"'
  Pop $0
SkipTransactionLogAcl:
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

  ; Re-aplicar las reglas de firewall si Windows / antivirus las bloquea.
  ; Se copia el .cmd desde los recursos del bundle (evita escribir archivos con NSIS).
  CopyFiles /SILENT "$INSTDIR\firewall-cmd.cmd" "C:\Sanatorio\Abrir puertos de Firewall.cmd"
  Delete "$INSTDIR\firewall-cmd.cmd"

  ; Log de resultado del netsh para diagnosticar fallas
  nsExec::ExecToLog 'cmd /c echo == %DATE% %TIME% == >> "C:\Sanatorio\firewall-setup.log"'
  Pop $0
  nsExec::ExecToLog 'cmd /c netsh advfirewall firewall delete rule name="Sanatorio Server" >> "C:\Sanatorio\firewall-setup.log" 2>&1'
  Pop $0
  nsExec::ExecToLog 'cmd /c netsh advfirewall firewall delete rule name="Sanatorio Discovery" >> "C:\Sanatorio\firewall-setup.log" 2>&1'
  Pop $0
  nsExec::ExecToLog 'cmd /c netsh advfirewall firewall delete rule name="Sanatorio App" >> "C:\Sanatorio\firewall-setup.log" 2>&1'
  Pop $0
  nsExec::ExecToLog 'cmd /c netsh advfirewall firewall add rule name="Sanatorio Server" dir=in action=allow protocol=TCP localport=8787 profile=private remoteip=LocalSubnet >> "C:\Sanatorio\firewall-setup.log" 2>&1'
  Pop $0
  nsExec::ExecToLog 'cmd /c netsh advfirewall firewall add rule name="Sanatorio Discovery" dir=in action=allow protocol=UDP localport=8788 profile=private remoteip=LocalSubnet >> "C:\Sanatorio\firewall-setup.log" 2>&1'
  Pop $0

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
  FileWrite $9 "Firewall de Windows: TCP 8787 y UDP 8788 se limitan a red local y perfil Privado.$\r$\n"
  FileWrite $9 "Si la red usa perfil Publico o la regla falla, configure el perfil autorizado$\r$\n"
  FileWrite $9 "en Windows Firewall; no desactive el firewall.$\r$\n"
  FileWrite $9 "Si algo bloquea la conexion, ejecute como$\r$\n"
  FileWrite $9 "administrador: C:\Sanatorio\Abrir puertos de Firewall.cmd$\r$\n"
  FileWrite $9 "El resultado queda registrado en C:\Sanatorio\firewall-setup.log.$\r$\n"
  FileWrite $9 "$\r$\n"
  FileWrite $9 "Si tenia una version en Program Files, puede desinstalarla desde$\r$\n"
  FileWrite $9 "Configuracion de Windows (la app nueva queda en C:\Sanatorio\app).$\r$\n"
  FileClose $9

  !insertmacro StopSanatorioProcesses
!macroend
