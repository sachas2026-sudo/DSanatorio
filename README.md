# Sanatorio — Centro Médico

Aplicación de escritorio para gestión clínica: pacientes, médicos, agenda, pagos, PDFs y configuración SMTP.

**Stack:** Tauri 2 · React 19 · Vite 8 · TypeScript

## Requisitos

- Node.js 20+
- Rust (solo para build desktop con Tauri)

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Frontend web en http://localhost:5173 |
| `npm run desktop` | App Tauri en modo desarrollo |
| `npm run build` | Compila TypeScript + bundle Vite |
| `npm run desktop:build` | Instalador Windows (Tauri) |
| `npm run lint` | ESLint |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:watch` | Tests en modo watch |

## Datos y respaldos

- **Web (dev):** `localStorage` bajo la clave `sanatorio-clinica-v1`.
- **Desktop:** archivo JSON en AppData; al salir se rotan 3 copias de resguardo.
- **Respaldo diario:** una copia fechada por día en `C:\Sanatorio\respaldo\diario\` (30 días de historial; también Dropbox si está activo).
- Importar/exportar JSON desde Configuración valida con `parseAppData`.

## Checklist smoke test (manual)

Ejecutar antes de entregar una versión o después de cambios en datos/PDFs:

### Arranque y navegación
- [ ] La app abre en **Inicio** al iniciar.
- [ ] Se puede navegar a Pacientes, Médicos, Agenda, Pagos y Configuración sin errores en consola.

### Pacientes y médicos
- [ ] Alta, edición y búsqueda de un paciente.
- [ ] Alta de médico con horario semanal; aparece en agenda.

### Agenda
- [ ] Reservar turno; aparece en la grilla del día.
- [ ] Cancelar turno; estado actualizado.
- [ ] Exportar **PDF Turnos** (semana y mes) abre vista previa.
- [ ] Modal **Especialidades** muestra días de atención correctos.

### Pagos
- [ ] Registrar pago vinculado a turno.
- [ ] Cancelar pago; aparece en Pagos cancelados.

### Datos
- [ ] Exportar JSON desde Configuración; archivo válido.
- [ ] Importar el mismo JSON; datos intactos.
- [ ] (Desktop) Cerrar app y verificar que existen respaldos rotativos.
- [ ] (Desktop) Ver en Configuración la lista de **respaldos diarios** (carpeta `diario/`).

### Build
- [ ] `npm run lint` — sin errores.
- [ ] `npm test` — todos los tests pasan.
- [ ] `npm run build` — compila sin errores.

### Recuperación de errores
- [ ] Forzar un error de UI (dev) muestra pantalla con **Reintentar** y **Volver a Inicio**.
- [ ] JSON corrupto al iniciar muestra pantalla de restauración con respaldos 1–3.
- [ ] Fallo al guardar muestra aviso rojo en la barra superior (no silencioso).

## Desarrollo

Credenciales por defecto (cambiar en Configuración → Usuarios): usuario `Admi` / clave `Admi`.

- Contraseñas de ingreso: hash PBKDF2 en almacenamiento local (no texto plano).
- Clave SMTP Gmail: archivo separado (`smtp-secret.txt` en AppData); no se incluye en export/backup JSON.
- Los tests cubren parsing de la base (`parseAppData`), persistencia (`appStorage`), respaldos (`appBackup`) y pagos múltiples (`paymentDisplay`).
