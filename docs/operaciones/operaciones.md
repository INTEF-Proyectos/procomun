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

### URL de capacidad en los logs (2026-11-03)

En algunas URL el permiso va en la propia URL. Quien lea un log con esas URL enteras puede abrirlas:

- el enlace firmado de un recurso no publicado (#466): `/api/v1/elpx/preview/<hash>/<token>/…`, válido 2 h;
- la instantánea de la vista previa del editor (#317): `/api/v1/preview/<id>/…` y `/api/v1/preview-session/<id>`;
- el `?token=` de la verificación de correo de Better Auth (`/api/auth/verify-email?token=…`).

El Referer también las lleva: el HTML del `.elpx` sale con `Referrer-Policy: same-origin`, así que los CSS, JS e imágenes del paquete se piden con la URL firmada en el Referer.

**Imagen `frontend` (nginx).** `nginx.conf` escribe el `access_log` con el formato `main_redacted`. Es el formato `main` de nginx:alpine con `$redacted_uri` y `$redacted_referer` en lugar de `$request` y `$http_referer`. Dos `map` cambian el token por `:token` y el id por `:previewId`, los mismos marcadores que `redactAuditPath` en la API (#317). El hash se conserva para saber qué recurso se vio. Las líneas de petición mal formadas (400) quedan como `"- - -"` en vez de en crudo. Lo comprueba `scripts/nginx-log-redaction.unit.test.ts`.

**Imagen `app` (despliegue canónico, ADR-0021).** No tiene nginx ni escribe las peticiones en stdout. En `api_access_logs` se guarda la ruta sin query. Hasta que #317 añada `redactAuditPath`, la ruta del enlace firmado de #466 se guarda entera.

**Proxy inverso delante de producción.** Tiene que hacer lo mismo: no registrar la URI ni el Referer en crudo en esas rutas. En nginx, copiar los dos `map` y el `log_format` de `nginx.conf`. En otro proxy o balanceador (Traefik, Caddy, HAProxy, el de la plataforma), quitar del log la ruta y la query de esas rutas, o redactarlas igual. Lo mismo vale para una CDN o un WAF que guarde URL.

**Límite conocido.** El `error_log` de nginx no admite formato. Un fallo con el upstream (502) escribe la petición, la URL del upstream y el Referer enteros. Restringe quién lo lee y guárdalo poco tiempo.

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
