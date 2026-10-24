# Configuración de Google Drive para Exportación de Pagos

## Descripción

El botón "Exportar a Gerencia" en Pagos de consultas ahora también sube automáticamente el archivo Excel a una carpeta de Exportación en Google Drive.

## Configuración

### 1. Crear un proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. Habilita la Google Drive API v3:
   - Ve a "APIs & Services" > "Library"
   - Busca "Google Drive API"
   - Haz clic en "Enable"

### 2. Crear credenciales OAuth 2.0

1. Ve a "APIs & Services" > "Credentials"
2. Haz clic en "Create Credentials" > "OAuth client ID"
3. Selecciona "Desktop application" como tipo de aplicación
4. Copia el **Client ID** y **Client Secret**

### 3. Obtener Refresh Token

Para obtener un refresh token, necesitas hacer una solicitud de autorización:

1. Abre este URL en tu navegador (reemplaza los valores):
```
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/drive.file
```

2. Autoriza la aplicación
3. Serás redirigido a una URL con un código de autorización
4. Usa el código para obtener el refresh token (puedes usar herramientas como Postman o curl)

### 4. Crear carpetas en Google Drive

**Carpeta de Exportación (para archivos Excel):**
1. Ve a tu Google Drive
2. Crea una carpeta llamada "Exportacion"
3. Obtén el ID de la carpeta desde la URL:
   - La URL será algo como: `https://drive.google.com/drive/folders/FOLDER_ID`
   - Copia el FOLDER_ID

**Carpeta de Backup (para copias de seguridad):**
1. Ve a tu Google Drive
2. Crea una carpeta llamada "Backup Cuidar Agenda"
3. Obtén el ID de la carpeta desde la URL:
   - La URL será algo como: `https://drive.google.com/drive/folders/FOLDER_ID`
   - Copia el FOLDER_ID

### 5. Configurar el archivo de credenciales

1. Copia el archivo `google_drive_config.example.json` a `google_drive_config.json`
2. Edita `google_drive_config.json` con tus credenciales:

```json
{
  "client_id": "TU_CLIENT_ID_REAL",
  "client_secret": "TU_CLIENT_SECRET_REAL",
  "refresh_token": "TU_REFRESH_TOKEN_REAL",
  "folder_id": "TU_FOLDER_ID_REAL",
  "backup_folder_id": "TU_BACKUP_FOLDER_ID_REAL"
}
```

3. Coloca el archivo `google_drive_config.json` en la raíz del proyecto (junto a `package.json`)

### 6. Nota Importante

La implementación actual es una simulación. Para que funcione realmente con Google Drive, necesitarás:

1. Implementar la autenticación OAuth 2.0 completa en el backend de Rust
2. Usar la librería de Google Drive API para Rust o hacer requests HTTP directos
3. Manejar la rotación de tokens de acceso

## Uso

### Exportación de Excel a Gerencia

Una vez configurado, cuando hagas clic en "Exportar a Gerencia":

1. El archivo Excel se guardará localmente (como antes)
2. El archivo también se subirá automáticamente a la carpeta "Exportacion" en Google Drive
3. Si hay un error al subir a Google Drive, verás un mensaje de error pero el archivo local se habrá guardado correctamente

### Backup Automático al Salir

Cuando cierres la aplicación:

1. Se guardará la base de datos localmente (como antes)
2. También se subirá automáticamente una copia de seguridad a la carpeta "Backup Cuidar Agenda" en Google Drive
3. El archivo de backup tendrá un nombre como `backup_1234567890.json` (timestamp UNIX)
4. Si hay un error al subir a Google Drive, el backup local se habrá guardado correctamente

### Recuperación de Backups desde Google Drive

Si la base de datos local está corrupta o no se puede cargar:

1. Al iniciar la aplicación, verás la pantalla de error de carga
2. En la sección "Respaldos en Google Drive" aparecerán los backups disponibles
3. Haz clic en el backup que deseas restaurar
4. El backup se descargará y restaurará automáticamente
5. Si no hay backups disponibles, verifica que las credenciales estén configuradas correctamente

## Solución de problemas

- **Error: "Faltan credenciales de Google Drive"**: Verifica que el archivo `google_drive_config.json` exista y tenga las credenciales correctas
- **Error al subir a Google Drive**: Revisa la consola para más detalles del error
- **Archivo no aparece en Drive**: Verifica que el folder_id sea correcto y que tengas permisos de escritura en esa carpeta
