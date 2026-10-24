# Plan de migración a uso en red — Sanatorio v15

## Objetivo
Pasar de una instalación local por PC a un esquema **1 PC servidor + 2 PC invitados**, con datos centralizados y niveles de acceso por usuario.

## Topología propuesta
- **PC Servidor**: contiene la base de datos y los usuarios. Ejecuta la app normalmente (admin/secretaria).
- **PC Invitado 1 (Afiliados)**: usuario `Afiliados` (rol restringido).
- **PC Invitado 2 (Admi)**: usuario `Admi` (rol admin, solo consulta/gestión según permisos).

## Usuarios y permisos
| PC | Usuario app | Rol | Menú visible |
|---|---|---|---|
| Servidor | Mary | secretaria | Inicio, Pacientes, Médicos, Agenda, Pagos (solo Pagos a Médicos), Cerrar sesión, Salir |
| Servidor | Andrea | secretaria | Igual que Mary |
| Invitado 1 | Afiliados | afiliado (nuevo rol) | Afiliados, Pacientes, Cerrar sesión, Salir |
| Invitado 2 | Admi | admin | Todo el menú |

> Nota: el rol `secretaria` ya oculta pestañas de Obras Sociales en Pagos (`role === 'admin'`). El rol `afiliado` requiere agregar un nuevo `AppRole` y reglas en `canAccessPath`, Layout y permisos.

## Fase 1 — Preparar servidor
1. Instalar/actualizar Sanatorio v15 en el servidor.
2. Verificar datos en `C:\Sanatorio\datos` (base SQLite + JSON).
3. Crear/verificar usuarios en Configuración:
   - `Aguirre Mary` → secretaria
   - `Barua Andrea` → secretaria
   - `Afiliados` → afiliado
   - `Admi` → admin
4. Configurar respaldos automáticos y verificar `C:\Sanatorio\respaldo`.

## Fase 2 — Compartir datos en red
1. Compartir la carpeta `C:\Sanatorio\datos` del servidor (ej. `\\SERVIDOR\SanatorioDatos`).
2. En cada invitado, mapear esa carpeta a `C:\Sanatorio\datos` (unidad de red o junction) **o** agregar configuración de ruta de datos en la app.
3. Garantizar permisos NTFS: invitados con lectura/escritura sobre la carpeta compartida.

## Fase 3 — Cambios de código necesarios
1. **Nuevo rol `afiliado`** en `src/lib/auth.ts`:
   - Agregar a `AppRole`.
   - `canAccessPath('afiliado', path)` permite solo `/afiliados`, `/pacientes`.
   - Validación de cuentas y sesión para el nuevo rol.
2. **Menú** (`src/components/Layout.tsx`): filtrar enlaces por `canAccessPath`; el rol afiliado verá solo Afiliados y Pacientes (más Cerrar sesión/Salir).
3. **Rutas protegidas** (`ProtectedRoute.tsx`): bloquear acceso directo a rutas no permitidas.
4. **Pagos**: mantener obras sociales solo para `admin` (ya implementado).
5. **Ruta de datos configurable** (opcional pero recomendado): variable de entorno o setting `SANATORIO_DATA_DIR` para apuntar al recurso compartido sin hardcodear `C:\Sanatorio\datos`.
6. **Concurrencia SQLite**: evaluar modo WAL y evitar escrituras simultáneas; si hay bloqueos, considerar un único proceso servidor o API.

## Fase 4 — Instalar invitados
1. Instalar Sanatorio v15 (actualización de código) en cada PC invitado.
2. Configurar ruta de datos hacia el servidor.
3. Iniciar sesión con el usuario correspondiente.
4. Verificar que el menú y permisos coincidan con la tabla.

## Fase 5 — Pruebas y validación
- Login de cada usuario y verificación de menú.
- Crear/editar paciente en invitado Afiliados y confirmar que aparece en servidor.
- Registrar pago como secretaria y confirmar que no aparece pestaña Obras Sociales.
- Admin en invitado puede acceder a Configuración/Mantenimiento.
- Respaldo diario y recuperación.

## Riesgos
- SQLite sobre red (SMB) puede tener bloqueos; probar con carga real.
- Si se comparte la misma base, los cierres inesperados pueden corromper datos: mantener respaldos.
- Los usuarios genéricos (`Admi`, `Afiliados`) deben existir en `auth-accounts.json` del servidor.

## Entregables
- Plan documentado (este archivo).
- (Opcional) Implementación del rol `afiliado` y ruta de datos configurable.
