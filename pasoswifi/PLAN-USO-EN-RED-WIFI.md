# Plan para usar Sanatorio en varias PCs por Wi‑Fi

## Objetivo

Usar una PC como servidor central y conectar otras PCs como clientes dentro de la misma red Wi‑Fi.

La PC servidor será la única que guardará los datos. Las demás PCs accederán al sistema mediante la red.

## Esquema final

```text
              ┌─────────────────────────────┐
              │ PC SERVIDOR                 │
              │ API + base de datos SQLite  │
              │ respaldos                    │
              └──────────────┬──────────────┘
                             │ Wi‑Fi/LAN
              ┌──────────────┴──────────────┐
              │                             │
      ┌───────▼────────┐           ┌────────▼───────┐
      │ PC principal   │           │ PC invitado    │
      │ usuario admin  │           │ usuario invitado│
      └────────────────┘           └────────────────┘
```

Más adelante se podrá agregar una tercera PC sin cambiar la base de datos.

## Importante sobre el estado actual

La aplicación actual guarda los datos localmente en cada instalación, principalmente en:

```text
C:\Sanatorio\datos\sanatorio-datos.json
```

Por eso, instalarla en dos PCs no comparte automáticamente la información. Tampoco se debe usar el mismo archivo JSON en una carpeta compartida, porque dos usuarios podrían sobrescribir cambios o dañar los datos.

Será necesario convertir el guardado local en un sistema central con API y base de datos.

## Etapa 1: preparar la PC servidor

1. Elegir una PC que quede encendida durante el horario de trabajo.
2. Conectarla al router. Si es posible, usar cable de red para mayor estabilidad.
3. Asignarle una IP fija, por ejemplo:

   ```text
   192.168.1.100
   ```

4. Instalar Node.js.
5. Crear una carpeta para el servidor.
6. Instalar allí la API y la base SQLite.
7. Configurar el servidor para que inicie automáticamente con Windows.

## Etapa 2: crear la base central

La base central tendrá como mínimo estas entidades:

- Pacientes.
- Médicos.
- Especialidades.
- Turnos.
- Pagos.
- Afiliados.
- Planes y cuotas.
- Usuarios y permisos.

La base SQLite estará solamente en la PC servidor. La API será la única encargada de modificarla.

## Etapa 3: migrar los datos actuales

1. Hacer un respaldo completo del archivo actual.
2. Exportar los datos desde Configuración.
3. Importar el JSON en la base central.
4. Comparar cantidades de pacientes, médicos, turnos, pagos y afiliados.
5. Conservar el JSON original como respaldo histórico.

No se debe borrar la base anterior hasta confirmar que la migración fue correcta.

## Etapa 4: adaptar la aplicación

La aplicación debe dejar de leer y guardar directamente en el archivo local.

En su lugar, debe comunicarse con la API mediante una dirección como:

```text
http://192.168.1.100:3000/api
```

La API deberá permitir:

- Consultar registros.
- Crear registros.
- Editar registros.
- Eliminar o suspender registros.
- Registrar pagos.
- Cancelar pagos.
- Consultar afiliados y cuotas.
- Generar reportes y PDFs usando los datos centrales.

## Etapa 5: usuarios y permisos

Para comenzar se recomienda crear solamente dos perfiles:

### Administrador

- Acceso a pacientes.
- Acceso a médicos.
- Acceso a agenda.
- Acceso a pagos.
- Acceso a afiliados.
- Configuración y respaldos.

### Invitado

- Consultar pacientes.
- Consultar agenda.
- Consultar afiliados.
- Cargar información permitida.
- Sin acceso a configuración, usuarios ni eliminación de datos.

Más adelante se pueden agregar perfiles de secretaria, médico y gerente.

## Etapa 6: conectar las PCs cliente

Desde cada PC cliente se abrirá la dirección del servidor:

```text
http://192.168.1.100:3000
```

Todas las PCs deben estar conectadas a la misma red Wi‑Fi y poder comunicarse con la IP del servidor.

La PC cliente no debe tener una base de datos independiente para el uso normal.

## Etapa 7: configurar Windows y la red

En la PC servidor:

1. Permitir el puerto de la API en el Firewall de Windows.
2. Permitir solamente conexiones de la red privada local.
3. Configurar la red Wi‑Fi como “Privada”.
4. Evitar publicar el puerto en Internet.
5. Mantener una IP fija o una reserva DHCP en el router.

## Etapa 8: respaldos

La PC servidor debe realizar automáticamente:

- Un respaldo diario.
- Un respaldo semanal.
- Una copia externa en Dropbox, Google Drive o disco externo.

También debe existir una forma de restaurar la base completa en otra PC si falla el servidor.

## Etapa 9: pruebas antes de habilitar el uso real

Probar desde ambas PCs:

1. Crear un paciente desde una PC y verlo desde la otra.
2. Editar el paciente desde la segunda PC.
3. Crear un turno.
4. Registrar un pago.
5. Editar un afiliado.
6. Consultar cuotas.
7. Generar un PDF.
8. Ingresar con usuario administrador.
9. Ingresar con usuario invitado.
10. Desconectar y reconectar el Wi‑Fi.
11. Reiniciar el servidor.
12. Restaurar un respaldo de prueba.

## Orden de trabajo recomendado

1. Diseñar la API y la base SQLite.
2. Migrar una copia de los datos actuales.
3. Adaptar primero Pacientes y Médicos.
4. Adaptar Agenda y Turnos.
5. Adaptar Pagos.
6. Adaptar Afiliados y Cuotas.
7. Agregar usuarios y permisos.
8. Configurar respaldos.
9. Probar con una segunda PC.
10. Incorporar la tercera PC.

## Resultado esperado

Con este cambio, las tres PCs trabajarán sobre una única fuente de datos. Un registro creado o editado desde una PC estará disponible para las demás inmediatamente, sin copiar archivos manualmente.

## Recomendación final

Para una primera versión rápida y estable:

- PC servidor con Node.js, API y SQLite.
- PCs clientes usando navegador.
- Red Wi‑Fi privada.
- IP fija para el servidor.
- Usuario administrador y usuario invitado.
- Respaldo automático diario.

Esta es la alternativa más simple para comenzar y permite crecer después sin rehacer toda la aplicación.
