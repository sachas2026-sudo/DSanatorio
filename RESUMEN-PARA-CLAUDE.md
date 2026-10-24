# Resumen para Claude — Sanatorio v15 (Migración a red + móvil)

## 1) Migración a red (server + 2 invitados)
- **Servidor**: base en `C:\Sanatorio\datos` (SQLite + JSON), usuarios Mary y Andrea (secretaria).
- **Invitado 1 (Afiliados)**: usuario `Afiliados` rol restringido (solo Afiliados y Pacientes).
- **Invitado 2 (Admi)**: usuario `Admi` rol admin (todo).
- **Menú secretaria**: Inicio, Pacientes, Médicos, Agenda, Pagos (solo Pagos a Médicos; Obras Sociales oculto). Admin-only paths: configuración, mantenimiento, backup, pagos-cancelados, afiliados.
- **Datos compartidos**: compartir `C:\Sanatorio\datos` por red y apuntar clientes a esa ruta (unidad mapeada o setting `SANATORIO_DATA_DIR`).
- **Código a ajustar**: nuevo rol `afiliado` en `auth.ts` (canAccessPath, Layout, ProtectedRoute), ruta de datos configurable, considerar WAL/concurrencia SQLite.
- **Riesgos**: SQLite sobre SMB, permisos NTFS, respaldos.

## 2) Móvil (APK/PWA) para ver resúmenes desde cualquier lugar
- **Servidor** publica resúmenes (PDF) en carpeta compartida + `index.json` con metadata y rol permitido.
- **App móvil** (PWA recomendada primero, luego APK) con login, lista filtrada por rol y visor PDF.
- **Roles**: afiliado (solo afiliados), secretaria (pagos a médicos), admin (todo).
- **Seguridad**: acceso por Wi‑Fi/VPN, login obligatorio, solo lectura de resúmenes (no base completa).
- **Entregables**: carpeta de resúmenes, índice JSON, PWA/APK, documentación.

## Archivos de referencia
- `PLAN-MIGRACION-RED.md`
- `PLAN-APK-RESUMENES.md`
