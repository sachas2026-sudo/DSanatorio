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

### Roles (secretaría vs administración)
- [ ] Ingresar como **Secretaria** / `123`: no aparecen Configuración ni Pagos cancelados en el menú.
- [ ] Secretaría: en Pagos no hay exportaciones Gerencia/Excel/correo ni PDF con pacientes.
- [ ] Secretaría: en Pacientes y Médicos no hay botón PDF; no se ve el % del médico.
- [ ] Secretaría: en Agenda no hay **Enviar Correo** (sí PDF Turnos local).
- [ ] Ingresar como **Admi**: todas las exportaciones y rutas admin disponibles.

### Producto
- [ ] Barra lateral: **v1.1.7 · F1 ayuda** abre modal Acerca de.
- [ ] **F1** o **?** (fuera de un campo de texto) abre ayuda con atajos y novedades.
- [ ] **Alt+4** lleva a Agenda; **Alt+7** solo funciona como administración.

### Datos
- [ ] Exportar JSON desde Configuración; archivo válido.
- [ ] Importar el mismo JSON; datos intactos.
- [ ] (Desktop) Cerrar app y verificar que existen respaldos rotativos.
- [ ] (Desktop) Ver en Configuración la lista de **respaldos diarios** (carpeta `diario/`).

### Build
- [ ] `npm run lint` — sin errores.
- [ ] `npm test` — todos los tests pasan (50+).
- [ ] `npm run build` — compila sin errores.

### Recuperación de errores
- [ ] Forzar un error de UI (dev) muestra pantalla con **Reintentar** y **Volver a Inicio**.
- [ ] JSON corrupto al iniciar muestra pantalla de restauración con respaldos 1–3.
- [ ] Fallo al guardar muestra aviso rojo en la barra superior (no silencioso).

## Dónde se guardan los datos (Windows, disco C:)

Al usar la app **instalada en Tauri** (no el navegador en desarrollo), **todo lo que cargás o modificás** (pacientes, médicos, turnos, pagos, configuración, etc.) se guarda automáticamente en disco. No hace falta un botón «Guardar base» en cada pantalla: cada cambio dispara un guardado con un pequeño retardo (~400 ms) para no escribir en disco en cada tecla.

### Base principal (siempre)

| Qué | Dónde (típico en C:) |
|-----|----------------------|
| **Base de datos** | `C:\Users\<tu usuario>\AppData\Roaming\com.sanatorio.gestion\sanatorio-datos.json` |
| **Clave SMTP** (aparte del JSON) | `...\com.sanatorio.gestion\smtp-secret.txt` |
| **Respaldos diarios** (30 días) | `...\com.sanatorio.gestion\diario\sanatorio-datos.YYYY-MM-DD.json` |

La ruta exacta la ves en **Configuración → Datos** al abrir la app instalada.

La base **no** vive dentro de la carpeta del `.exe` (por ejemplo `C:\Program Files\...`). Así, al **actualizar o reinstalar** el programa en C:, **tus datos no se borran**.

### Copias de resguardo en C:

| Qué | Dónde |
|-----|--------|
| **3 respaldos rotativos** (al salir / cada hora con la app abierta) | `C:\Sanatorio\respaldo\` |
| **Dropbox** (opcional, si está instalado) | `C:\Users\LAS\Dropbox\Sanatorio\respaldo\` |

Si `C:\Sanatorio\respaldo` no se puede crear, los respaldos van a una subcarpeta `respaldo` dentro de AppData (misma unidad C:).

### Qué no cambió con los refactors recientes

Los cambios de organización del código (Agenda, libs, CSS) **no alteraron** `save_app_data`, `load_app_data` ni el formato del JSON. Mismo archivo, mismas reglas de respaldo.

### Desarrollo en navegador (`npm run dev`)

Sin Tauri, los datos van a **localStorage** del navegador (solo para probar). Para uso real en la clínica, usá el **instalador en C:**.

## Desarrollo

Credenciales por defecto (cambiar en Configuración → Usuarios): usuario `Admi` / clave `Admi`.

- Contraseñas de ingreso: hash PBKDF2 en almacenamiento local (no texto plano).
- Clave SMTP Gmail: archivo separado (`smtp-secret.txt` en AppData); no se incluye en export/backup JSON.
- Los tests cubren parsing de la base (`parseAppData`), persistencia (`appStorage`), respaldos (`appBackup`) y pagos múltiples (`paymentDisplay`).
