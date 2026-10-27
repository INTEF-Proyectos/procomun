# Design — Miniaturas generadas en el servidor

* Issue: #470
* ADR: ADR-0046 (Propuesto; las opciones y la justificación están allí)
* Fecha: 2026-10-27

Diseño de la opción recomendada (servicio `thumbnailer` con Playwright + cola en PostgreSQL). Queda pendiente de que se cierren las preguntas abiertas.

## Flujo

```
subida / editor / admin / import legacy
        │ processElpxUpload → has_screenshot? index.html?
        ▼
elpx_projects.thumbnail_status = pending
        │
        ▼  bucle en la API (si THUMBNAILER_URL)        red interna, sin salida
SELECT … FOR UPDATE SKIP LOCKED ──POST /render {hash}──► thumbnailer (Chromium)
        ▲                                                  │ lee storageDir/elpx/<hash>/ (ro)
        └──────────── imagen | empty | timeout | error ◄───┘
        │
        ▼
storageDir/thumbnails/<sha256>.jpg  +  thumbnail_status = done
        │
        ▼
elpxPreview.thumbnailUrl → tarjeta (sin iframe)
```

## Datos

Columnas nuevas en `elpx_projects` (migración con el siguiente número libre):

| Columna | Tipo | Notas |
|---|---|---|
| `thumbnail_status` | text | `pending`, `processing`, `done`, `empty`, `failed`, `skipped`; nulo en los anteriores al cambio |
| `thumbnail_file` | text | nombre en `thumbnails/`, validado con `THUMBNAIL_FILE_RE` |
| `thumbnail_attempts` | integer | por defecto 0 |
| `thumbnail_error` | text | motivo saneado con `sanitizeForLog` |
| `thumbnail_updated_at` | timestamptz | para recuperar los `processing` colgados |

Índice parcial sobre `thumbnail_status = 'pending'`.

## Componentes

* **`apps/thumbnailer/`** — servidor HTTP interno. `POST /render {hash}`: valida el hash con `HASH_PATTERN`, abre un contexto nuevo, intercepta con `page.route("**/*")`. Las peticiones a `https://elpx-thumb.invalid/<ruta>` se resuelven desde disco con comprobación de contención (`realpath` dentro del directorio del paquete) y cabeceras como `elpx-content.ts`, `ELPX_HTML_CSP` incluida. Todas las demás se abortan. Navega a `index.html`, espera a `load`, a `document.fonts.ready` y a un margen corto, comprueba que haya texto o imágenes visibles y captura en JPEG.
* **`apps/api/src/thumbnails/`** — interfaz `ThumbnailRenderer` con el adaptador HTTP de `thumbnailer` (y, si se elige, uno para Gotenberg), el bucle de trabajos y el guardado en el almacén de #472.
* **`processElpxUpload`** — devuelve el estado inicial de la miniatura; quien lo llama lo persiste junto a `has_screenshot`.
* **`elpxPreview`** — añade `thumbnailUrl` (`/api/v1/thumbnails/<file>` o `null`).
* **`resourceCardMedia`** — se quita la rama del iframe.
* **CLI `elpx:thumbnails`** — marca `pending` y saca el informe.

## Despliegue

* Nueva etapa `thumbnailer` en el `Dockerfile` (base con `chromium-headless-shell` y sus bibliotecas, usuario sin privilegios).
* Servicio `thumbnailer` en `docker-compose.yml`: red `internal: true` compartida solo con `app`, volumen de almacenamiento en `:ro`, `read_only: true`, `tmpfs` para `/tmp`, `mem_limit`, `cpus` y `pids_limit`, sin secretos.
* `app` recibe `THUMBNAILER_URL` y `THUMBNAILER_CONCURRENCY`.
* Documentar en `docs/operaciones/` cómo activarlo, ver el estado del relleno y vaciar los `failed`.

## Seguridad

Tres capas: origen opaco por la CSP, sandbox de Chromium con usuario sin privilegios y contenedor sin red, sin secretos y en solo lectura. El servicio no expone puertos fuera de la red interna.

## Pruebas previstas

* Unitarios: bucle y transiciones de estado (PGlite), reintentos, recuperación de `processing` colgados, adaptador HTTP, interceptor (contención, `..`, symlink, URL externa abortada, CSP en HTML) y comando de relleno.
* Integración (con Chromium): paquete sintético que intenta `fetch` externo, `document.cookie` y un bucle infinito. No sale ninguna petición, el tiempo máximo corta y la portada vacía da `empty`.
* e2e: ninguna tarjeta de Explorar, portada ni colecciones contiene un `<iframe>`.
* Piloto: 200 paquetes reales de eXe 2, 3 y 4 para medir el tiempo por paquete, el tamaño y la calidad.
