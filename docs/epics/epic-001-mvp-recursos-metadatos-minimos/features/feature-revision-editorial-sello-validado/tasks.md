# Tasks — Revisión editorial y sello «Validado»

* Issues: #496 y #420
* ADR: ADR-0049
* Fecha: 2026-11-03

## 2026-11-03 — Análisis y propuesta (sin código)

- [x] Revisar el código actual: estados y transiciones (`validation.ts`), `canManageResource` y #460, `updateEditorialStatus` y `assignedCuratorId`, `activity_events`, `api_access_logs`, correo (ADR-0031), versionado (ADR-0039) y `certified` en el importador legacy
- [x] ADR-0049 en estado Propuesto, con opciones (incluidas soluciones de mercado), recomendación y preguntas abiertas
- [x] requirements.md + design.md
- [ ] Decisión del equipo sobre las preguntas abiertas de ADR-0049 (#496 y #420)

## Pendiente tras la decisión

### Fase 1a — Estados, acciones, historial y comentarios

- [ ] Migración: columnas nuevas de `resources` y tablas `resource_editorial_events`, `resource_review_comments` y `notifications`, también en `setup.ts` (PGlite). El número se elige al implementarla, revisando los PR abiertos
- [ ] `packages/db/src/editorial-rules.ts`: tabla de acciones, `allowedActions`, `validateEditorialAction`, `canEditResource` y `canAccessReviewThread`, con tests de la matriz por rol
- [ ] `applyEditorialAction` en una transacción (estado, curator, evento y notificaciones), con un test de que todo se deshace si algo falla
- [ ] `assigned_curator_id`: solo lo cambian «Revisar», «Reasignar» y las decisiones de un curator o un admin. Revisar `keepsAccessAfterStatusChange` y `--fix-published`
- [ ] Rutas `editorial-actions`, `editorial`, `review-comments` y `review-queue`, con tests de 400, 403 y 409
- [ ] `PATCH /:id/status` como envoltorio de las acciones sin motivo
- [ ] Test: los comentarios no salen en la ficha, la API v1, los feeds ni el FTS

### Fase 1b — Sello e importados

- [ ] Poner el sello al aprobar o validar y conservarlo con las ediciones de un curator o un admin
- [ ] `onPublicContentChanged` en cada ruta de escritura de contenido (metadatos, `.elpx`, adjuntos, etiquetas y áreas), con un test por ruta
- [ ] `validatedAt` en las lecturas de listados y detalle, y `validated` en la API v1 y los feeds
- [ ] `resolveLegacyCertified` y sello al importar, con tests sobre los fixtures
- [ ] `import:legacy-procomun --mark-certified [--dry-run]` con informe
- [ ] Si se aprueba la pregunta 11: relleno del sello desde `activity_events`, con informe en seco

### Fase 1c — Interfaz

- [ ] Botones del editor desde `allowedActions` y sin las copias de `TRANSITION_RULES`
- [ ] Diálogos de motivo y lista de comprobación, y aviso de pérdida del sello
- [ ] Pestaña «Revisión» con la línea de tiempo y los comentarios
- [ ] Cola de revisión en Administrar → Recursos
- [ ] Distintivo «Validado» en la ficha y las tarjetas (DESIGN.md, `design:lint`)
- [ ] Mensajes en Paraglide y `in_review` → `review` en `lib/types/editorial.ts`
- [ ] `PreviewApiClient` con los métodos nuevos
- [ ] e2e del recorrido completo y axe sobre los componentes nuevos

### Fase 1d — Notificaciones y correo

- [ ] `recipientsFor` según la tabla de ADR-0049, con tests sin duplicados
- [ ] Campana, contador y página «Notificaciones»
- [ ] Bucle de correo (`NOTIFICATIONS_EMAIL`), plantillas y preferencia en el perfil, con tests sobre `LogEmailTransport`
- [ ] Documentar la variable en `docs/operaciones/` y las comunicaciones editoriales en `docs/epics/ens/evaluacion-rgpd.md`

### Fase 2

- [ ] Filtro y faceta «Solo validados» en el buscador y la API v1
- [ ] Cambios pendientes sobre recursos publicados (`published_version_id` y `resource_pending_changes`), con adenda a ADR-0039
- [ ] Sello en la exportación LOM-ES (`metaMetadata.contribute`, rol `validator`) cuando exista

### Cierre

- [ ] ADR-0049 a Aceptado con las decisiones, y status.yaml
- [ ] validation.md con los resultados de las pruebas

## 2026-11-03 — Cambio de roles (#506, #507 y #515)

Las cuentas nuevas y las importadas pasan a ser `editor` y el editor ya no envía a revisión. El sello se gana sobre todo validando lo publicado (ADR-0049, opciones H y punto 11).

- [x] ADR-0049, requirements y design actualizados: quién sigue siendo `author`, opciones H1 a H5, tabla de transiciones sin `editor → review` y preguntas R1 a R4
- [ ] Decisión del equipo sobre R1 a R4

Se añade a la fase 1:

- [ ] Reglas con listas de roles explícitas, sin `hasMinRole`, y test de que un `editor` no tiene `submit`, ni para enviar ni para reenviar (si #506 entra antes, se conserva su test)
- [ ] `validation_status` en `resources`, con las acciones `request_validation`, `withdraw_validation_request`, `validate`, `request_changes` y `deny_validation` sobre publicados
- [ ] Vistas «Validación solicitada» y «Publicados sin validar» en la cola, con sus filtros
- [ ] e2e de la validación de lo publicado: el editor publica y pide la validación, y el curator la valida

## 2026-11-16 — Sello «Validado» (#420)

Decidido en #420 (propuesta del 2026-11-03, aprobada por @jacoboAlcantara): sello al «Aprobar y publicar» de un curator o un admin, sin sello en la publicación directa del editor, sello en los importados con `certified`, visible en la ficha y en las tarjetas, se conserva con las ediciones de curator y admin y se pierde con las del autor. El filtro «Solo validados» va en #568. Detalle en la adenda 2026-11-16 de ADR-0049.

- [x] Migración 0026 (`validated_at`, `validated_by`, `validation_source`) y `setup.ts`
- [x] `packages/db/src/validation-seal.ts`: `validationSealOnStatusChange`, `keepsValidationOnEdit` e `isResourceValidated`
- [x] Sello al «Aprobar y publicar» (`review → published`), que se conserva al archivar y se quita al volver a borrador
- [x] `onPublicContentChanged` en metadatos (admin y API v1), etiquetas, `.elpx` (subir, guardar y generar) y adjuntos (subir y borrar), con un test por ruta
- [x] `validatedAt` y `validationSource` en el detalle, los listados, las colecciones, los relacionados y los favoritos, sin `validated_by`
- [x] Distintivo «Validado» en la ficha y en las tarjetas, y aviso en el editor, en los cinco idiomas
- [x] `isLegacyCertified` y sello al importar, con `importedValidated` y `certifiedAsDraft` en el informe
- [x] `import:legacy-procomun --mark-certified [--dry-run]` con informe
- [ ] Evento `validation_removed` cuando exista `resource_editorial_events` (fase 1a)
- [ ] `validated` en los feeds
- [ ] Filtro «Solo validados» (#568)
