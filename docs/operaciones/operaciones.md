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

## Miniaturas generadas en el servidor (2026-11-03, #470, ADR-0046)

Las tarjetas de los paquetes `.elpx` sin `screenshot.png` y sin la imagen `preview` del Procomún antiguo usan una miniatura de su portada. La captura la hace el servicio `thumbnailer` (`apps/thumbnailer/`, Chromium sin interfaz con Playwright) y la encola un bucle dentro de la API. Los listados ya no cargan el paquete en un iframe: mientras un recurso no tiene miniatura se ve el marcador de su tipo.

### Cómo se activa

- `docker compose up -d` levanta `thumbnailer` junto a `app`. La API solo arranca el bucle si tiene `THUMBNAILER_URL` (en `docker-compose.yml`, `http://thumbnailer:3100`). Sin esa variable todo sigue igual, con el marcador por tipo.
- `thumbnailer` no publica puertos, solo está en la red interna `thumbnails` (sin salida a Internet), no tiene secretos ni base de datos, corre como usuario sin privilegios con el sistema de ficheros en solo lectura y monta el volumen `uploads` en solo lectura.
- Memoria y CPU: `THUMBNAILER_MEM_LIMIT` (1g por defecto) y `THUMBNAILER_CPUS` (1.0). `THUMBNAILER_CONCURRENCY=2` son dos capturas a la vez; si se sube, hay que subir también la memoria.
- El resto de variables está en `.env.example`.

### Sandbox de Chromium

El contenedor usa `apps/thumbnailer/seccomp-chromium.json` (el perfil seccomp por defecto de Docker más los espacios de nombres de usuario, copia del de Playwright 1.64.1) y conserva solo la capacidad `SYS_CHROOT`. Con eso el sandbox de Chromium funciona sin root.

Si el host no permite espacios de nombres de usuario sin privilegios (por ejemplo, Ubuntu 23.10 o posterior con `kernel.apparmor_restrict_unprivileged_userns=1`), Chromium no arranca: el log de `thumbnailer` dice `Chromium no arranca` y `/health` responde 503. Los trabajos no se pierden: la API los devuelve a la cola sin gastar intentos. Hay dos salidas:

1. Permitir el sandbox en el host (perfil de AppArmor para el contenedor), que es lo recomendable.
2. `THUMBNAILER_CHROMIUM_SANDBOX=false`. Quedan las demás capas: origen opaco por la CSP, todas las peticiones interceptadas desde disco, red interna sin salida, sin secretos y solo lectura.

### Relleno del fondo

Antes, `elpx:screenshots` (#409) marca los paquetes que ya traen `screenshot.png`, que no necesitan captura.

```bash
# Cuántos recursos sin imagen hay y en qué estado está la cola
docker compose exec app bun run apps/cli/src/index.ts elpx:thumbnails --dry-run

# Encolar por tandas; se puede repetir y sigue donde lo dejó
docker compose exec app bun run apps/cli/src/index.ts elpx:thumbnails --limit 5000

# Volver a intentar los fallidos (failed) y las portadas vacías (empty)
docker compose exec app bun run apps/cli/src/index.ts elpx:thumbnails --force
```

El comando solo marca filas como `pending`; las capturas las hace el bucle de la API, de `THUMBNAILER_CONCURRENCY` en `THUMBNAILER_CONCURRENCY`. El estado está en `elpx_projects.thumbnail_status` (`pending`, `processing`, `done`, `empty`, `failed`, `skipped`) y el motivo del último fallo en `thumbnail_error`:

```sql
SELECT thumbnail_status, count(*) FROM elpx_projects GROUP BY 1;
SELECT hash, thumbnail_attempts, thumbnail_error FROM elpx_projects WHERE thumbnail_status = 'failed' LIMIT 20;
```

Un fallo pasajero se reintenta hasta completar `THUMBNAILER_MAX_ATTEMPTS` intentos (por defecto 3, con esperas de 1 y 4 minutos). Un trabajo que se queda en `processing` más de `THUMBNAILER_STALE_AFTER_MS` (la API se reinició a mitad) vuelve a la cola y cuenta como intento.

## Acceso a las miniaturas según el estado editorial (2026-11-03, revisión de #481)

Las miniaturas del almacén (`storageDir/thumbnails/`: la `preview` legacy y la generada) ya no se sirven a cualquiera. Detalle en la adenda 2026-11-03 de ADR-0046.

- `/api/v1/thumbnails/<fichero>` solo responde 200 si el fichero pertenece al menos a un recurso publicado y no borrado. Si no, 404. Cabecera `Cache-Control: public, max-age=3600` (antes, un año e `immutable`).
- Lo no publicado se sirve por `/api/v1/thumbnails/signed/<caducidad>.<firma>/<fichero>`, firmado con `BETTER_AUTH_SECRET` y válido 2 horas, con `Cache-Control: private, no-store`. Cambiar el secreto invalida los enlaces emitidos, igual que los de la vista previa del paquete.
- Al archivar un recurso, su miniatura da 404 desde la petición siguiente. Un navegador o un proxy pueden conservar la copia hasta 1 hora.
- La migración `0020_thumbnail_owner_indexes` añade los índices parciales sobre `resources.thumbnail_url` y `elpx_projects.thumbnail_file` que usa la comprobación.
- Si se despliega con la etapa `frontend` (nginx), `nginx.conf` necesita `location ^~ /api/v1/thumbnails/`: sin ella, la regex de estáticos se queda con los `.jpg` y las miniaturas no llegan a la API.

Para saber por qué una miniatura da 404:

```sql
-- ¿A qué recursos pertenece y en qué estado están?
SELECT r.id, r.editorial_status, r.deleted_at IS NOT NULL AS borrado
FROM resources r
WHERE r.thumbnail_url = '/api/v1/thumbnails/<fichero>'
UNION ALL
SELECT r.id, r.editorial_status, r.deleted_at IS NOT NULL
FROM elpx_projects p JOIN resources r ON r.id = p.resource_id
WHERE p.thumbnail_file = '<fichero>';
```
