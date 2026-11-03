# Uso de Sanatorio en Red (PC1 servidor + PC2/PC3 clientes)

## Arquitectura

```
                    ┌─────────────────────────────┐
                    │ PC1 SERVIDOR                │
                    │ App Sanatorio (modo server) │
                    │ API HTTPS :8787             │
                    │ SQLite + respaldos           │
                    └──────────────┬──────────────┘
                                   │ Wi-Fi/LAN
                    ┌──────────────┴──────────────┐
                    │                             │
            ┌───────▼────────┐           ┌────────▼───────┐
            │ PC2 CLIENTE    │           │ PC3 CLIENTE    │
            │ App Sanatorio  │           │ App Sanatorio  │
            │ (modo client)  │           │ (modo client)  │
            └────────────────┘           └────────────────┘
```

## Requisitos

- Las 3 PCs deben estar en la misma red (Wi-Fi o cableada).
- PC1 debe tener IP fija o reserva DHCP en el router (recomendado: 192.168.1.100).
- Las PCs deben poder comunicarse entre sí (ping).

## Paso 1: Configurar PC1 (Servidor)

1. Conectar PC1 al router (preferiblemente por cable).
2. Asignar IP fija (ej: 192.168.1.100).
3. Abrir PowerShell como Administrador.
4. Ejecutar:
   ```powershell
   cd D:\Proyectos\Sanatorio
   .\scripts\configurar-pc1-servidor.ps1
   ```
5. El script detecta la IP, configura el firewall (puerto 8787) y genera `names.txt`.
6. Iniciar la aplicacion Sanatorio en PC1 (modo servidor).
7. El certificado TLS se genera automaticamente. Copiar `server-cert.pem` de:
   ```
   %APPDATA%\Sanatorio\config\tls\server-cert.pem
   ```

## Paso 2: Configurar PC2 (Cliente)

1. En PC2, abrir PowerShell.
2. Ejecutar:
   ```powershell
   cd D:\Proyectos\Sanatorio
   .\scripts\configurar-pc2-cliente.ps1
   ```
3. Ingresar la IP del servidor (ej: 192.168.1.100).
4. Pegar el contenido de `server-cert.pem` cuando se solicite.
5. Ejecutar la aplicacion Sanatorio en PC2. Detectara modo cliente automaticamente.

## Paso 3: Configurar PC3 (Cliente)

Igual que PC2, usando `configurar-pc3-cliente.ps1`.

## Pruebas

Verificar desde PC2/PC3:
1. Crear un paciente desde PC2 y verlo desde PC3.
2. Editar desde PC3 y verificar en PC2.
3. Crear turnos, registrar pagos, consultar afiliados.
4. Desconectar y reconectar Wi-Fi.
5. Reiniciar el servidor (PC1) y verificar reconexion.

## Notas

- El servidor (PC1) debe estar encendido durante el horario de trabajo.
- Si la IP del servidor cambia, re-ejecutar `configurar-pc1-servidor.ps1` y reconfigurar los clientes.
- El certificado TLS se regenera automaticamente si cambia `names.txt`.
- Los respaldos se realizan en PC1 (servidor).