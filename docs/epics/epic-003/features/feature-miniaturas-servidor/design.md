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

## Actualización 2026-11-03 — ADR aceptada y acceso según el estado editorial

### Estado

ADR-0046 está **Aceptada** desde el 2026-11-03 y ya no quedan preguntas abiertas: las cerró @juanda en #470. Ver [«Decisiones del 2026-11-03» en ADR-0046](../../../../negocio/decisiones/0046-miniaturas-generadas-en-servidor.md#decisiones-del-2026-11-03). La cabecera «(Propuesto)» y la frase «Queda pendiente de que se cierren las preguntas abiertas» quedan como historia.

Cambia respecto al diseño de arriba:

* **Tarjeta:** `screenshot.png` > `preview` legacy > miniatura generada > marcador por tipo. El iframe sale de los listados al desplegar, sin esperar al relleno.
* **Relleno:** `elpx:thumbnails` marca solo los proyectos sin `screenshot.png` ni `preview` legacy.
* **Captura:** JPEG de 640×400 solo del contenido; se oculta la navegación de eXe (menú, cabecera y paginación).
* **Componentes:** la línea de `elpxPreview` que daba siempre `/api/v1/thumbnails/<file>` queda sustituida por lo que sigue.

### Acceso a las miniaturas (revisión de @jacoboAlcantara en #481)

Decisión y razones en la «Adenda 2026-11-03 — acceso a las miniaturas según el estado editorial» de ADR-0046. Requisitos RF-7 a RF-11, RNF-6, RNF-7 y criterios CA-1 a CA-10 en `requirements.md`.

```
                       ¿estado del recurso?
                 publicado │            │ borrador, revisión, archivado
                           ▼            ▼  (solo si canViewResource)
  /api/v1/thumbnails/<fichero>      /api/v1/thumbnails/signed/<exp>.<firma>/<fichero>
           │                                   │
           ▼                                   ▼
  ¿pertenece a un recurso publicado,   ¿firma válida y sin caducar, y el
   no borrado, por thumbnail_url o     fichero pertenece a algún recurso
   por el proyecto .elpx vigente?      no borrado?
     sí → 200 public, max-age=3600       sí → 200 private, no-store
     no → 404                            no → 404
```

Componentes:

* **`packages/db/src/repository/elpx-thumbnails.ts`** — `getThumbnailFileVisibility(db, fichero, urlLegacy)`: `"public"` si el fichero pertenece al menos a un recurso publicado (por `resources.thumbnail_url` o por el proyecto vigente), `"private"` si solo pertenece a recursos no publicados o a proyectos que no son el vigente, y `null` si no pertenece a ningún recurso no borrado.
* **Migración nueva** (siguiente número libre) — índices parciales sobre `resources.thumbnail_url` y `elpx_projects.thumbnail_file` (`WHERE … IS NOT NULL`), para que la consulta no recorra las tablas en cada imagen.
* **`apps/api/src/thumbnails/access.ts`** — firma y verificación del token (`thumbnail:v1:<fichero>:<exp>`, el mismo secreto y los mismos 2 horas que `elpx/preview-token.ts`, que pasa a compartir la función de firma), `buildSignedThumbnailUrl(fichero)` y `thumbnailUrlForStatus(url, estado)`: URL estable si está publicado, firmada si no, `null` si la URL es nuestra y el nombre no es válido, y la URL externa tal cual.
* **`apps/api/src/routes/thumbnails.ts`** — `GET /:file` con la comprobación de visibilidad y `Cache-Control: public, max-age=3600`; `GET /signed/:token/:file` con la verificación del token y `Cache-Control: private, no-store`. Las dos responden 404 con el mismo cuerpo en todos los rechazos.
* **`apps/api/src/routes/elpx-content.ts`** — en el enlace firmado del paquete, `screenshot.png` de la raíz se sirve con `private, no-store`.
* **`buildElpxPreview(elpx, estado)`** — `thumbnailUrl` pasa por `thumbnailUrlForStatus`. Sigue devolviendo `null` solo si no hay ni visor ni miniatura (#471).
* **Rutas que emiten URL:**
  * Ficha: `buildElpxPreview(elpx, estado)` y `thumbnailUrl` por `thumbnailUrlForStatus`, tras `canViewResource`.
  * `enrichResourceCards(filas, usuario)` (panel, favoritos, valoraciones): publicado → URL estable; no publicado y `canViewResource` → firmada; si no, `elpxPreview: null`. Las valoraciones añaden `createdBy` a su consulta para poder decidirlo.
  * Administración: el listado y el detalle de `/api/admin/resources` firman `thumbnailUrl`; `/api/admin/collections/:id/resources` la firma si el usuario puede ver el recurso y la deja en `null` si no.
  * Listados públicos, colecciones públicas, recomendados y búsqueda: sin cambios, porque solo traen publicados.
* **`nginx.conf`** — `location ^~ /api/v1/thumbnails/` con `proxy_pass`, como la de `/api/v1/elpx/`, para que la regex de estáticos no se quede con las imágenes.

### Pruebas del acceso

* **Repositorio (PGlite):** visibilidad de un fichero en borrador, revisión, publicado y archivado; imagen compartida entre un publicado y un borrador; proyecto vigente frente a la copia de trabajo de un recurso publicado; recurso borrado; fichero sin dueño.
* **Firma:** crear y verificar; caducidad; otro fichero; firma alterada; un token de la vista previa del paquete no vale como token de miniatura.
* **`thumbnailUrlForStatus` y `buildElpxPreview`:** URL estable si está publicado, firmada si no, URL externa intacta, nombre no válido descartado y `elpxPreview` con visor o miniatura (#471).
* **Ruta, con recursos reales:** borrador, revisión, publicado y archivado por la URL estable, con sus cabeceras de caché; publicado → archivado da 404 en la petición siguiente y archivado → borrador → publicado vuelve a dar 200; el enlace firmado sirve el borrador con `private, no-store` y rechaza el token alterado, caducado, de otro fichero o del paquete.
* **Emisión:** la ficha del borrador para su autora, el panel, los favoritos de un recurso archivado (con y sin permiso) y el listado de administración no contienen ninguna `/api/v1/thumbnails/<fichero>` sin firma de un recurso no publicado.
* **`screenshot.png`** por el enlace firmado del paquete: `private, no-store`.

## Actualización 2026-11-04 — estado aceptado y el interceptor en el contexto (revisión de #481)

**Estado.** ADR-0046 está **Aceptada** desde el 2026-11-03, con las siete decisiones de @juanda recogidas en su sección «Decisiones del 2026-11-03». La cabecera de este documento y de `requirements.md` decía «Propuesto» y el diseño hablaba de preguntas pendientes: ya no las hay. Se conserva el texto anterior, como pide `AGENTS.md`.

**Corrección del aislamiento.** Donde arriba dice `page.route("**/*")` conservando `ELPX_HTML_CSP`, hay que leer:

* **`browserContext.route("**/*", …)` registrado antes de crear o navegar ninguna página.** `page.route()` no intercepta la primera petición de una ventana emergente (así lo documenta Playwright), y la red Docker `internal` no impide hablar con `app`, que está en la misma red.
* **CSP propia para la captura, sin `allow-popups` ni `allow-popups-to-escape-sandbox`.** Se mantienen el origen opaco y `serviceWorkers: "block"`.
* **Criterio de aceptación:** una prueba de integración con un paquete que intente abrir una ventana hacia un servidor que simule la API y reciba **cero peticiones**.

El detalle y el porqué están en la adenda del 2026-11-04 de ADR-0046.
