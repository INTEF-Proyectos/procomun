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
