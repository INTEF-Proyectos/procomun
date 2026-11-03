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
