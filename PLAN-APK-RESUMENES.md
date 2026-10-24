# Plan — APK móvil para ver resúmenes (Sanatorio)

## Objetivo
Permitir consultar resúmenes (PDF/JSON) desde el celular, conectándose al servidor de Sanatorio por Wi‑Fi.

## Arquitectura propuesta
- **Servidor**: Sanatorio v15 genera y publica resúmenes en una carpeta compartida o endpoint HTTP.
- **Móvil**: App (PWA o APK) que lista y descarga resúmenes.

## Fases
### 1. Exponer datos en servidor
- Definir carpeta `C:\Sanatorio\resumenes` compartida en red.
- Exportar automáticamente los PDF de resúmenes (Resumen Cuidar, Obras Sociales, Agenda) a esa carpeta.
- Generar un índice JSON (`index.json`) con metadata: fecha, título, archivo, rol permitido.

### 2. App móvil mínima
- Pantallas:
  1. Login (usuario/clave, reutiliza auth-accounts.json).
  2. Lista de resúmenes (filtrada por rol).
  3. Visor de PDF (descarga/visualización).
- Roles:
  - `afiliado`: solo resúmenes de afiliados.
  - `secretaria`: resúmenes de pagos a médicos.
  - `admin`: todos.

### 3. Opciones de implementación
- **PWA (recomendada para empezar)**:
  - Reutiliza la app web existente.
  - Se instala en el celular desde el navegador.
  - Consume `index.json` y PDFs por HTTP.
- **APK (Tauri Mobile)**:
  - Requiere Android Studio + SDK + NDK.
  - Adaptar UI a móvil.
  - Generar APK firmada.
- **APK (React Native/Flutter)**:
  - App nueva, consume los mismos datos.

### 4. Seguridad
- Acceso solo por Wi‑Fi local o VPN.
- Login obligatorio.
- No exponer la base SQLite completa, solo resúmenes.

### 5. Entregables
- Carpeta compartida de resúmenes.
- `index.json` actualizado automáticamente.
- PWA o APK instalable.
- Documentación de instalación en celular.

## Riesgos
- Exponer archivos por red requiere permisos NTFS correctos.
- Los PDF pueden ser pesados; considerar compresión.
- La app móvil no debe modificar datos, solo lectura.
