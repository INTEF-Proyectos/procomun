# Tasks — Miniaturas generadas en el servidor

* Issue: #470
* ADR: ADR-0046
* Fecha: 2026-10-27

## 2026-10-27 — Análisis y propuesta (sin código)

- [x] Revisar el código actual: extracción, servicio de `.elpx`, almacén de miniaturas (#472), `has_screenshot` (#471), FTS y Docker
- [x] ADR-0046 en estado Propuesto con opciones (incluido Gotenberg y SaaS), riesgos y recomendación
- [x] requirements.md + design.md
- [ ] Decisión del usuario sobre las preguntas abiertas de la issue

## Pendiente tras la decisión

- [ ] Prueba técnica: Playwright con `chromium-headless-shell` bajo Bun en la imagen; medir el tamaño de la imagen
- [ ] Piloto con unos 200 paquetes reales (tiempo, tamaño, calidad, portadas vacías)
- [ ] Migración de `elpx_projects` con las columnas de miniatura
- [ ] `apps/thumbnailer/` con interceptor y tests
- [ ] Bucle de trabajos y adaptador en la API con tests
- [ ] Estado inicial en `processElpxUpload` y en todos los sitios que lo llaman
- [ ] `thumbnailUrl` en `elpxPreview` y orden nuevo de la tarjeta, sin iframe
- [ ] CLI `elpx:thumbnails`
- [ ] Etapa en el `Dockerfile`, servicio en `docker-compose.yml` y `docs/operaciones/`
- [ ] e2e: listados sin iframes
- [ ] ADR-0046 a Aceptado y status.yaml

## 2026-11-03 — Decisión

- [x] Decisión del usuario sobre las preguntas abiertas de la issue (@juanda, ver «Decisiones del 2026-11-03» en ADR-0046)
- [x] ADR-0046 a Aceptado y status.yaml

Cambia respecto a la lista de arriba:

- El iframe sale de los listados en el mismo PR que el `thumbnailer`, sin esperar al relleno.
- `elpx:thumbnails` marca solo los proyectos sin `screenshot.png` ni `preview` legacy.
- La captura oculta la navegación de eXe.

## 2026-11-03 — Revisión de #481 (@jacoboAlcantara)

Documentación (este PR):

- [x] Acceso a las miniaturas de recursos no publicados: enlace firmado, caché, comportamiento al despublicar e imágenes `preview` legacy (adenda en ADR-0046)
- [x] Criterios de aceptación CA-1 a CA-10 en `requirements.md` y pruebas en `design.md`
- [x] Contexto de ADR-0046 y alternativa de Gotenberg al día con #483 y la adenda de ADR-0026
- [x] `requirements.md` y `design.md` con la ADR aceptada y el enlace a «Decisiones del 2026-11-03»

Implementación (en #512, apilado sobre #471):

- [ ] `getThumbnailFileVisibility` e índices parciales en una migración nueva
- [ ] Firma de miniaturas en `apps/api/src/thumbnails/access.ts`
- [ ] Ruta estable con comprobación y `public, max-age=3600`; ruta firmada con `private, no-store`
- [ ] `screenshot.png` del enlace firmado con `private, no-store`
- [ ] `buildElpxPreview`, la ficha, el panel, favoritos, valoraciones y administración con la URL según el estado
- [ ] `location ^~ /api/v1/thumbnails/` en `nginx.conf`
- [ ] Tests de CA-1 a CA-10

## 2026-11-16 — Revisión de #512 (@jacoboAlcantara, 2026-11-08)

- [x] [P1] La cola de miniaturas pasa a `0020_elpx_thumbnail_queue` y los índices a `0021_thumbnail_owner_indexes`, con `when` posteriores a la `0019_user_profile` de #488. Regresión con el migrador real de drizzle: base nueva, base migrada con main y base con la 0019 de #488.
- [x] [P2] El contenido visible se mide después de `settleMs`. Test de integración con Chromium con contenido que aparece durante la espera.
- [x] [P2] CSP propia de captura (`CAPTURE_HTML_CSP`) sin `allow-popups` ni `allow-popups-to-escape-sandbox`. El test de paridad comprueba las garantías comunes con el visor y los permisos que se quitan; test de integración de que `window.open` no abre nada.

- [x] `recupera los processing colgados…` (elpx-thumbnails) fallaba también en la punta revisada al correr el fichero completo (aislado pasaba): el primer reclamo se llevaba proyectos pendientes de tests anteriores, creados antes. El test fija `created_at` anteriores.

## 2026-11-21 — Publicación de la imagen del thumbnailer (#519)

- [x] Publicar las etapas `app` y `thumbnailer` al superar la CI de `main`. El servicio de miniaturas queda disponible en `ghcr.io/intef-proyectos/procomun-thumbnailer` con las etiquetas `main` y `latest`.
- [x] Escanear ambas imágenes en el mismo workflow con Trivy, usando el digest devuelto por GHCR. Los hallazgos quedan en el log del job y los fallos de ejecución de Trivy fallan el job.
- [x] Agrupar `@playwright/test` y `playwright-core` en Dependabot y verificar en CI que sus versiones exactas coinciden.

## 2026-11-21 · Limpieza manual de miniaturas (#520)

- [x] Añadir simulación y borrado por CLI con siete días de margen y un informe de archivos y bytes.
- [x] Preservar miniaturas de proyectos históricos, recursos dados de baja y portadas con referencia local.
- [x] Cubrir la limpieza y su repetición con una base y un almacén temporales.
