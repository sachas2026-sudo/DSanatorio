# Sanatorio - Servidor

Infraestructura inicial independiente del cliente React/Tauri.

## Incluye esta etapa

- Servidor Fastify.
- Puerto configurable, por defecto `3000`.
- Configuración mediante `.env`.
- Creación automática de carpetas.
- Base SQLite `sanatorio.db` creada automáticamente.
- Verificación de conexión SQLite.
- Endpoint `GET /health`.
- Tablas de negocio base del servidor: `pacientes`, `medicos`, `turnos`, `pagos`, `afiliados`, `cuotas`, `roles`, `usuarios` y `planes`.

## Instalación

Desde la carpeta `Servidor`:

```powershell
npm install
```

## Iniciar en desarrollo

```powershell
npm run dev
```

## Iniciar normalmente

```powershell
npm start
```

El servidor escucha por defecto en:

```text
http://0.0.0.0:3000
```

Desde otra PC de la red se probará usando la IP de la PC servidor, por ejemplo:

```text
http://192.168.1.100:3000/health
```

## Probar el estado

En PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "database": "connected",
  "version": "1.0.0"
}
```

## Carpetas creadas

Por defecto se crean:

```text
C:\Sanatorio\DB
C:\Sanatorio\Backups
C:\Sanatorio\Logs
```

La base se crea en:

```text
C:\Sanatorio\DB\sanatorio.db
```

## Migraciones de SQLite

Las migraciones se ejecutan automáticamente cada vez que inicia el servidor. El runner crea la tabla `schema_version`, busca las versiones ya aplicadas y ejecuta solamente las pendientes dentro de una transacción. La migración `001_initial` prepara la infraestructura y no crea tablas de negocio.

Para agregar una migración futura:

1. Crear un archivo numerado en `src/database/migrations`, por ejemplo `012_alguna_tabla.ts`.
2. Exportar una migración con una versión mayor, una descripción y su función `up`.
3. Agregarla al arreglo `migrations` de `src/database/migrations/index.ts`.
4. Compilar y arrancar el servidor. Se ejecutará una sola vez y quedará registrada en `schema_version`.

No se deben editar ni reutilizar versiones ya ejecutadas. Cada cambio de esquema debe tener un número nuevo.

## Evolución futura de afiliados y planes

La migración `010_create_planes` separa el catálogo de planes en una tabla propia y normaliza `afiliados.plan_id` para que apunte a `planes.id`. El campo `legacy_id` de `planes` conserva el identificador de origen para facilitar la futura migración desde JSON sin perder trazabilidad.

## Evolución futura de cuotas

La migración `007_create_cuotas` mantiene la cuota como una entidad única relacionada con el afiliado y el paciente. Si más adelante se necesitan reglas reutilizables de financiación, convendrá crear tablas separadas para tipos de cuota, planes de financiación o períodos, sin sobrecargar esta tabla.

## Índices compuestos

Además de los índices simples ya existentes, se agregaron índices compuestos para consultas frecuentes:

- `turnos (medico_id, fechaHora)`
- `pagos (paciente_id, fecha)`
- `cuotas (afiliado_id, anio, mes)`

Se eligieron solo esos tres porque cubren los filtros y listados más probables sin duplicar demasiado los índices simples.

## Convención DTO

Para la API futura se va a mantener esta convención:

- Los IDs principales viajarán como números enteros.
- `legacy_id` quedará como cadena solo para compatibilidad con la migración desde JSON.
- Las fechas puras usarán `YYYY-MM-DD`.
- Las fechas con hora usarán formato ISO 8601 completo.
- Los valores opcionales o ausentes se representarán con `null`, no con cadenas vacías.
- Los `boolean` del cliente se convertirán a `0/1` solo en SQLite.
- La API expondrá nombres en `camelCase` para alinearse con React; la capa de persistencia podrá conservar los nombres actuales del esquema donde ya existan.

## Auditoría y updated_at

La actualización de `updated_at` se hará en los servicios del servidor/API, no con triggers SQLite. Eso mantiene la lógica visible y más fácil de probar. Si más adelante una tabla necesita trazabilidad por usuario, se evaluará agregar `creado_por` y `modificado_por` en una migración aparte, solo donde tenga sentido.

## Nota

Esta infraestructura no modifica el cliente React/Tauri ni la base JSON actual. La migración de datos y la API de negocio serán etapas posteriores.
