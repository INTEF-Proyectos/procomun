# Guía de Operaciones

Esta guía describe las tareas operativas rutinarias y la resolución de problemas para el administrador del sistema Procomun.

## Procedimientos de Backup y Restauración

### Copia de seguridad de la base de datos
```bash
docker exec -t procomun-db-1 pg_dumpall -c -U procomun > dump_`date +%d-%m-%Y"_"%H_%M`.sql
```

### Copia de seguridad de archivos (Uploads)
Haga un backup del directorio configurado mediante `UPLOAD_STORAGE_DIR`:
```bash
tar -cvf uploads_backup.tar ./local-data/uploads
```

### Restauración
```bash
cat dump_XX.sql | docker exec -i procomun-db-1 psql -U procomun
```

## Monitorización y Health Checks

### Endpoints de Salud
- **API Health Check**: `GET /health` (Retorna 200 si el servidor está vivo).
- **Docker Health Checks**: Configurados para el servicio `db` en `docker-compose.yml`.

### Métricas de Sistema
Se recomienda monitorizar el consumo de CPU y RAM de los contenedores mediante `docker stats` o herramientas de terceros.

## Rotación de Logs

Docker gestiona la rotación de logs de forma nativa mediante el driver `json-file`. Configúrelo en `/etc/docker/daemon.json` para evitar que ocupen todo el espacio en disco:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

## Actualización de la Plataforma (Process of Upgrade)

1. **Obtener última versión**:
   ```bash
   git pull origin main
   ```
2. **Construir nuevas imágenes**:
   ```bash
   docker compose build
   ```
3. **Reiniciar servicios**:
   ```bash
   docker compose up -d
   ```

## Troubleshooting: problemas comunes y soluciones

- **Error de Conexión a DB**: Verifique que el contenedor `db` esté `healthy` con `docker ps`.
- **Fallos en Subida de Archivos**: Compruebe permisos de escritura en `UPLOAD_STORAGE_DIR` y espacio en disco.

## Gestión de usuarios y roles desde CLI

Utilice la herramienta CLI de administración:
```bash
# Listar usuarios
bun run --filter '@procomun/cli' cli -- user-list

# Crear administrador
bun run --filter '@procomun/cli' cli -- user-create --email admin@midominio.com --name "Admin Local" --role admin --password "mi-pass-seguro"
```

### El registro de auditoría no guarda el token de los enlaces firmados (2026-11-04)

`api_access_logs` guarda la ruta de cada petición a la API (middleware `auditMiddleware`, requisito del ENS). En el enlace firmado de un recurso no publicado (#466) el permiso va en la propia URL, `/api/v1/elpx/preview/<hash>/<token>/…`, así que guardar la ruta entera dejaba el token en la tabla: quien pudiera leerla podía abrir el contenido no publicado mientras el enlace no caducase (2 h).

`redactAuditPath` (`apps/api/src/auth/audit.ts`) cambia el token por `:token` antes de escribir. El hash se conserva, que es lo que dice qué recurso se vio. El marcador es el mismo que usa el `access_log` de nginx (#524), para que las dos fuentes se lean igual.

`c.req.path` no trae la query, así que el `?token=` de la verificación de correo nunca llegó a esta tabla. El mismo helper tapa el resto de URL con permiso en la ruta: la miniatura firmada de un recurso no publicado (#512, `/api/v1/thumbnails/signed/<token>/<fichero>` → `:token`) y la instantánea de la vista previa del editor (#317, `/api/v1/preview/<id>/…` y `/api/v1/preview-session/<id>/…` → `:previewId`, solo si el segmento tiene forma de UUID). No distingue mayúsculas, y como Hono entrega `c.req.path` ya decodificado, una ruta con escapes (`previe%77`) se registra tapada igual. Cuando #317 se rebase, debe quedarse con esta versión de `redactAuditPath` en lugar de la suya.

**Filas anteriores al arreglo.** Las que ya estén guardadas conservan el token. Los tokens caducan a las 2 h, así que las antiguas no sirven para abrir nada, pero conviene no exportar esa columna en crudo.
