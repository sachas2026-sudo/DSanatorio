; Copia las bases incluidas en el instalador (solo si aún no existen en el equipo).
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$APPDATA\com.sanatorio.gestion"
  IfFileExists "$APPDATA\com.sanatorio.gestion\sanatorio-datos.json" +3 0
    IfFileExists "$INSTDIR\resources\sanatorio-datos.json" 0 +2
      CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.json" "$APPDATA\com.sanatorio.gestion\sanatorio-datos.json"

  CreateDirectory "C:\Sanatorio\respaldo"
  IfFileExists "C:\Sanatorio\respaldo\sanatorio-datos.respaldo-1.json" +3 0
    IfFileExists "$INSTDIR\resources\sanatorio-datos.respaldo-1.json" 0 +2
      CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.respaldo-1.json" "C:\Sanatorio\respaldo\"
  IfFileExists "C:\Sanatorio\respaldo\sanatorio-datos.respaldo-2.json" +3 0
    IfFileExists "$INSTDIR\resources\sanatorio-datos.respaldo-2.json" 0 +2
      CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.respaldo-2.json" "C:\Sanatorio\respaldo\"
  IfFileExists "C:\Sanatorio\respaldo\sanatorio-datos.respaldo-3.json" +3 0
    IfFileExists "$INSTDIR\resources\sanatorio-datos.respaldo-3.json" 0 +2
      CopyFiles /SILENT "$INSTDIR\resources\sanatorio-datos.respaldo-3.json" "C:\Sanatorio\respaldo\"
!macroend
