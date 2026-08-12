# Tasks — Épica 005: versionado de recursos

## MVP — issue #31 / ADR-0039
- [x] Crear `resource_versions` y `resources.current_version_id`.
- [x] Permitir varios `elpx_projects` por recurso y proteger los referenciados por historial.
- [x] Crear automáticamente una versión en upload, save y generate de `.elpx`.
- [x] Mantener historial con número, fecha, autor, vigente y descarga.
- [x] Implementar restauración no destructiva para curador/admin.
- [x] Resolver la ficha pública mediante la versión vigente.
- [x] Eliminar notas de versión y la acción/API manual de «publicar nueva versión».
- [x] Mover la migración de versionado a `0007_resource_versions.sql` para convivir con `0006_user_email_case_insensitive` de `main`.
- [x] Actualizar ADR-0039 y pruebas al flujo automático.

## Posterior
- [ ] Política configurable de retención y GC.
- [ ] Purgado administrativo explícito.
- [ ] Diff visual opcional.

## Corrección de renderizado — 2026-08-12
- [x] Integrar el panel de historial directamente en el editor para evitar que su montaje previo al estado `ready` lo deje sin destino.
- [x] Cubrir la edición existente y el alta inicial con una prueba de composición de página.

## Corrección de restauración en el editor — 2026-08-12
- [x] Hacer que el editor resuelva el ELPX de `current_version_id` después de restaurar una versión histórica.
- [x] Cubrir por API que el editor recibe el ELPX restaurado, no el proyecto creado más recientemente.

## Previsualización de versiones históricas — 2026-08-12
- [x] Exponer una URL de previsualización solo para versiones cuyo ELPX conserva contenido renderizable.
- [x] Añadir junto a «Restaurar» la acción «Ver», que abre el ELPX histórico en una modal aislada y accesible.
- [x] Cubrir la URL de previsualización de la API y el iframe seguro de la modal.

## Afinado de acciones del historial — 2026-08-12
- [x] Diferenciar visualmente «Ver» como acción principal y «Restaurar» como acción secundaria, con iconos, foco visible y estados de interacción.
