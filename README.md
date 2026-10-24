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

## CI

En cada push/PR a `main` o `master`, GitHub Actions ejecuta `npm run lint`, `npm test`, `npm run build` y `cargo test` (respaldos Rust).

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
- [ ] Ingresar como **Secretaria** / `123`: no aparecen Configuración, Mantenimiento ni Pagos cancelados en el menú.
- [ ] Secretaría en Pagos: Resumen por Médico (PDF), Excel Gerencia, Correo (PDF resumen, no Gerencia); sin PDF Obra Social ni pendientes sin pago.
- [ ] Secretaría en Pacientes y Médicos: botón PDF de listado; ve el % del médico.
- [ ] Secretaría en Agenda: **PDF Turnos** y **Enviar Correo** disponibles.
- [ ] Ingresar como **Admi**: todas las exportaciones Gerencia, pendientes y rutas admin disponibles.

### Producto
- [ ] Barra lateral: versión actual · **F1 ayuda** abre modal Acerca de.
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

## Dónde se guarda todo (Windows — disco C:)

Todo queda bajo **`C:\Sanatorio\`**:

| Carpeta | Contenido |
|---------|-----------|
| `C:\Sanatorio\app\` | Programa instalado (.exe) |
| `C:\Sanatorio\datos\` | Base de datos (`sanatorio-datos.json`), usuarios de ingreso y clave SMTP |
| `C:\Sanatorio\respaldo\` | 3 respaldos rotativos + carpeta `diario\` (30 días) |

Al **actualizar o reinstalar**, los datos en `datos\` y `respaldo\` **no se borran**.

El instalador solo reemplaza `C:\Sanatorio\app\`. En `C:\Sanatorio\` hay también `LEEME-ACTUALIZACION.txt` con los pasos.

### Cómo actualizar en una PC ya instalada

1. Cerrar la app.
2. Ejecutar el **nuevo instalador** (mismo asistente; no hace falta desinstalar antes).
3. Abrir la app: pacientes, turnos, pagos, usuarios y claves siguen en `C:\Sanatorio\datos\`.

En futuras versiones, `C:\Sanatorio\datos\install-meta.json` registra la versión instalada y permite migraciones automáticas de datos si el formato cambia.

Si venía de una versión anterior, la base en AppData se **migra sola** a `C:\Sanatorio\datos\`.

La ruta exacta de la base la ves en **Configuración → Datos** al abrir la app.

### Dropbox (opcional)

Si Dropbox está instalado: `C:\Users\<usuario>\Dropbox\Sanatorio\respaldo\`

### Qué no cambió con los refactors recientes

Los cambios de organización del código (Agenda, libs, CSS) **no alteraron** `save_app_data`, `load_app_data` ni el formato del JSON. Mismo archivo, mismas reglas de respaldo.

### Desarrollo en navegador (`npm run dev`)

Sin Tauri, los datos van a **localStorage** del navegador (solo para probar). Para uso real en la clínica, usá el **instalador en C:**.

Compilar instalador:

```powershell
npm run installer:build
```

## Desarrollo

Credenciales por defecto (cambiar en Configuración → Usuarios): usuario `Admi` / clave `Admi`.

- Contraseñas de ingreso: hash PBKDF2 en `auth-accounts.json` (`C:\Sanatorio\datos`); migración automática desde localStorage.
- Clave SMTP Gmail: archivo separado (`smtp-secret.txt` en `C:\Sanatorio\datos`); no se incluye en export/backup JSON.
- Los tests cubren parsing de la base (`parseAppData`), persistencia (`appStorage`), respaldos (`appBackup`) y pagos múltiples (`paymentDisplay`).
