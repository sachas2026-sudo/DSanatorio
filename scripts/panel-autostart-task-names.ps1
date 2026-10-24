# Tareas de Windows que arrancaban panel/tunel al iniciar sesion (legacy + actuales).
# No crear nuevas tareas AtLogOn; solo eliminarlas al instalar o abrir la app.
$script:PanelAutoStartScheduledTaskNames = @(
  'SanatorioPanel',
  'SanatorioPanelTunnel',
  'CuidarPanel',
  'CuidarPanelTunnel'
)

function Remove-PanelAutoStartScheduledTasks {
  foreach ($name in $script:PanelAutoStartScheduledTaskNames) {
    $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($existing) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Host "Tarea automatica eliminada: $name (ya no inicia al encender la PC)" -ForegroundColor Gray
    }
  }
}

function Stop-PanelAutoStartScheduledTasks {
  foreach ($name in $script:PanelAutoStartScheduledTaskNames) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    }
  }
}
