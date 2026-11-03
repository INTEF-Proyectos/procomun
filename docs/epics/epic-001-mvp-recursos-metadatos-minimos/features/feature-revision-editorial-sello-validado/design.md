# Design — Revisión editorial y sello «Validado»

* Issues: #496 y #420
* ADR: ADR-0049 (Propuesto; las opciones y la justificación están allí)
* Fecha: 2026-11-03

Diseño de la propuesta de ADR-0049: la fase 1 completa y un esquema de la fase 2. Queda pendiente de que se cierren las preguntas abiertas.

## Estados y acciones

Camino principal:

```
draft ──Enviar a revisión──► review ──Aprobar y publicar (+ sello)──► published ──Archivar──► archived
```

El resto:

* `review → draft`: Retirar de revisión (creador).
* `review → changes_requested`: Solicitar correcciones. `changes_requested → review`: Reenviar a revisión.
* `review → rejected`: Rechazar. `rejected → draft`: Reabrir (admin).
* `draft → published` y `changes_requested → published`: Publicar directamente (editor o superior, sin sello).
* `published → published`: Solicitar validación, Validar (+ sello) o Solicitar correcciones, sin despublicar.
* `archived → draft`: Restaurar a borrador (− sello).
* «Revisar (asignármelo)» y «Reasignar» no cambian el estado, sino `assigned_curator_id`.

La tabla completa de quién puede hacer cada acción está en ADR-0049, punto 2.

Cada acción es una entrada de la tabla de reglas:

```ts
type EditorialAction =
  | "submit" | "withdraw" | "claim" | "reassign"
  | "approve" | "request_changes" | "reject" | "reopen"
  | "publish_direct" | "request_validation" | "validate"
  | "archive" | "restore";

type ActionRule = {
  action: EditorialAction;
  from: EditorialStatus[];
  to: EditorialStatus | null;   // null: no cambia el estado
  who: "creator" | "creator_editor" | "curator" | "admin";
  reason: "required" | "optional" | "none";
  checklist: boolean;           // approve, validate
  requiresComplete: boolean;    // #408: submit, approve, publish_direct
  grantsValidation: boolean;    // approve, validate
  removesValidation: boolean;   // restore
};
```

`allowedActions(user, resource)` filtra esa tabla con el rol, la relación con el recurso (creador, curator asignado) y el estado. Lo usan el servidor, para validar, y la respuesta de `GET …/editorial`, para pintar los botones.

## Datos

Una migración con el siguiente número libre en `main` al implementarla, y lo mismo en `setup.ts` para PGlite.

### Columnas nuevas en `resources`

| Columna | Tipo | Notas |
|---|---|---|
| `validated_at` | timestamp | nulo = sin sello |
| `validated_by` | text, FK `user` `ON DELETE SET NULL` | nulo en los legacy |
| `validation_source` | varchar(20) | `review` o `legacy` |
| `validation_requested_at` | timestamp | solicitud de validación de un publicado (fase 1) |

Índice parcial `resources_validated_idx` sobre `validated_at` con `WHERE validated_at IS NOT NULL AND deleted_at IS NULL`, para el filtro de la fase 2. Índice `resources_review_queue_idx` sobre `(editorial_status, assigned_curator_id)`.

`editorial_status` sigue siendo `varchar(50)`: los valores nuevos no necesitan migrar el tipo. `assigned_curator_id` y `curated_at` se quedan; cambia quién los escribe (ADR-0049, punto 3).

### `resource_editorial_events` (append-only)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | UUID |
| `resource_id` | text, FK `resources` `ON DELETE CASCADE` | los recursos se borran con `deleted_at`, así que en la práctica no se pierde nada |
| `action` | varchar(40) | las de la tabla de reglas, más `validation_removed` y `validation_granted_legacy` |
| `from_status` / `to_status` | varchar(50) | iguales si la acción no cambia el estado |
| `actor_id` | text, FK `user` `ON DELETE SET NULL` | nulo para el sistema (importación) |
| `actor_role` | varchar(20) | rol en el momento de la acción |
| `reason` | text | obligatorio según la regla; como mucho 5000 caracteres |
| `version_id` | text, FK `resource_versions` `ON DELETE SET NULL` | `current_version_id` en ese momento |
| `metadata_snapshot` | jsonb | solo en `submit`, `approve` y `validate` |
| `details` | jsonb | lista de comprobación, curator anterior y nuevo, causa de `validation_removed` |
| `created_at` | timestamp | |

Índice `(resource_id, created_at)`. El repositorio solo expone `insert` y lecturas.

### `resource_review_comments`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `resource_id` | text, FK `resources` `ON DELETE CASCADE` | |
| `author_id` | text, FK `user` `ON DELETE SET NULL` | |
| `author_role` | varchar(20) | |
| `aspect` | varchar(30) | `content`, `accessibility`, `license`, `metadata`, `sources`, `other` o nulo |
| `body` | text | de 1 a 5000 caracteres, texto plano |
| `status_at_time` | varchar(50) | estado del recurso al comentar |
| `version_id` | text, FK `resource_versions` `ON DELETE SET NULL` | |
| `created_at` | timestamp | |

Índice `(resource_id, created_at)`. Sin edición ni borrado en la fase 1.

### `notifications`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `user_id` | text, FK `user` `ON DELETE CASCADE` | destinatario |
| `type` | varchar(50) | `changes_requested`, `approved`, `rejected`, `validated`, `archived`, `reopened`, `resubmitted`, `withdrawn`, `assigned`, `validation_requested`, `comment` |
| `resource_id` | text, FK `resources` `ON DELETE CASCADE` | |
| `event_id` | text, FK `resource_editorial_events` `ON DELETE CASCADE` | nulo si es un comentario |
| `comment_id` | text, FK `resource_review_comments` `ON DELETE CASCADE` | nulo si es un evento |
| `actor_id` | text, FK `user` `ON DELETE SET NULL` | |
| `read_at` | timestamp | |
| `email_status` | varchar(20) | `pending`, `sent`, `failed` o `skipped` |
| `email_attempts` | integer | por defecto 0 |
| `created_at` | timestamp | |

Índices únicos parciales `(user_id, event_id)` y `(user_id, comment_id)`. Índice `(user_id, read_at)` para el contador. Índice parcial sobre `email_status = 'pending'`.

Preferencia de correo: una columna booleana `notify_by_email` en `user_profile`, la tabla de perfil que crea #488 (PR abierto, migración `0017`). El valor por defecto depende de la pregunta 5; la propuesta es `true`. Si #488 no ha entrado, va en `user`.

## Componentes

* **`packages/db/src/editorial-rules.ts`.** La tabla `ActionRule[]`, `allowedActions`, `validateEditorialAction` (rol, estado, motivo, lista de comprobación) y `canEditResource` y `canAccessReviewThread`. Sustituye a `TRANSITION_RULES` y `validateTransition`, que se mantienen como envoltorio mientras exista `PATCH /:id/status`.
* **`packages/db/src/repository/editorial.ts`.** `applyEditorialAction(db, { resourceId, actor, action, reason, checklist, curatorId })`. En una transacción, bloquea la fila (`FOR UPDATE`), vuelve a validar, actualiza `resources` (estado, curator, sello), inserta el evento y las notificaciones. También `listTimeline`, `addReviewComment`, `listReviewQueue` y `removeValidation(db, resourceId, actor, cause)`.
* **`onPublicContentChanged(resource, actor, cause)`.** Un único punto que llama cada ruta de escritura de contenido: `PUT /api/admin/resources/:id`, subida y guardado del `.elpx` (`routes/admin/elpx.ts`, `routes/uploads.ts`, `routes/exelearning-editor.ts`), adjuntos (`/:id/media`), etiquetas (`/api/admin/tags/resources/:id`) y áreas. Si el recurso está publicado y validado y el actor no es curator ni admin, llama a `removeValidation`.
* **Notificaciones y correo (`apps/api/src/notifications/`).** `recipientsFor(event)` aplica la tabla de destinatarios de ADR-0049, punto 8. El bucle de correo, activo si `NOTIFICATIONS_EMAIL=true` y hay transporte, toma lotes de `pending` con `FOR UPDATE SKIP LOCKED`, envía con `getEmailTransport()` y marca `sent` o `failed` tras 3 intentos. Las plantillas van en español, en texto plano y HTML sencillo, con el título y el enlace a `/editar/<id>`.
* **Importador legacy.** `resolveLegacyCertified(json.certified)` en `packages/db/src/legacy-import/`, como `publication-status.ts`. El mapeo devuelve `validated: boolean` y el repositorio de importación pone `validated_at` y `validation_source = 'legacy'` si el recurso entra publicado. Opción `--mark-certified` en `apps/cli/src/commands/import-legacy-procomun.ts`, con informe `informe_certificados-<runId>.json`.
* **Lecturas públicas.** `validatedAt` entra en `resourceListSelection` y `resourceDetailSelection`. La API v1 y los feeds añaden `validated` y `validatedAt`. Ningún serializador público lee las tablas de comentarios ni de eventos.

## API

| Método y ruta | Quién | Cuerpo y respuesta |
|---|---|---|
| `POST /api/admin/resources/:id/editorial-actions` | según la regla | `{ action, reason?, checklist?, curatorId? }` → `{ status, assignedCuratorId, validated, allowedActions }`; 400 si falta el motivo, la lista o algún campo (#408), 403 si no le toca, 409 si el estado cambió entre medias |
| `GET /api/admin/resources/:id/editorial` | `canAccessReviewThread` | `{ status, assignedCurator, validated, validatedAt, validationRequestedAt, allowedActions, timeline: [evento o comentario…] }` |
| `POST /api/admin/resources/:id/review-comments` | `canAccessReviewThread` | `{ body, aspect? }` → comentario creado |
| `GET /api/admin/review-queue?view=` | curator, admin | `unassigned`, `mine`, `changes_requested` o `validation_requested`; paginado y ordenado por el envío más antiguo |
| `GET /api/admin/notifications?unread=` | usuario con sesión | lista paginada y `unreadCount` |
| `POST /api/admin/notifications/:id/read` y `/read-all` | destinatario | |

`PATCH /api/admin/resources/:id/status` se queda mientras el frontend migra. Traduce `status` a la acción equivalente y devuelve 400 si esa acción pide motivo.

## Interfaz

* **Editor (`EditarPageBase.tsx`).** Los botones salen de `allowedActions`. Las acciones con motivo abren un diálogo con un `textarea` obligatorio y, para pedir correcciones, la elección del aspecto. Aprobar y validar abren la lista de comprobación. Hay un aviso antes de guardar si se va a perder el sello. Pestaña «Revisión» con la línea de tiempo (eventos y comentarios) y el formulario de comentario. Al reenviar, el curator ve «Cambios desde la última revisión»: la diferencia campo a campo entre el `metadata_snapshot` del último `request_changes` y el del envío nuevo, y un enlace al historial de versiones si cambió el `.elpx`. Se quitan las copias de `TRANSITION_RULES` de `EditarPageBase.tsx` y `ResourceEditorIsland.tsx`.
* **Cola (Administrar → Recursos).** Pestaña «Revisión» con las cuatro vistas. Columnas: título, autor, estado, fecha de envío, curator asignado y días de espera.
* **Mis recursos.** Estado, última decisión y comentarios sin leer.
* **Cabecera.** Campana con el contador y página «Notificaciones».
* **Ficha y tarjetas.** Distintivo «Validado», con icono y texto, y en la ficha la fecha y una explicación breve.
* **Textos.** Los mensajes nuevos van en Paraglide (`apps/frontend/messages/*.json`). Las etiquetas de los estados salen de un solo mapa, y `lib/types/editorial.ts` pasa de `in_review` a `review`.
* **Vista previa estática.** `PreviewApiClient` implementa los métodos nuevos sobre PGlite (ADR-0010 y ADR-0012).

## Seguridad y privacidad

* Toda acción vuelve a comprobar permisos en el servidor dentro de la transacción. La UI nunca decide.
* Los comentarios son texto plano: se escapan al pintarlos y se limitan a 5000 caracteres. La API no tiene un límite general de peticiones (solo hay uno en `auth/token-auth.ts`), así que `review-comments` lleva su propio límite por usuario, p. ej. 10 por minuto.
* Ni el hilo ni el historial salen bajo `/api/v1/`. Hay un test que recorre los serializadores públicos con un recurso con comentarios y comprueba que no aparece su texto.
* Hay que añadir a `docs/epics/ens/evaluacion-rgpd.md` las comunicaciones editoriales como datos de actividad.

## Fase 2 (esquema)

* `resources.published_version_id`, que resuelve el `.elpx` público en lugar de `current_version_id` (ficha, `elpx-content.ts`, cookie de vista previa de #466).
* `resource_pending_changes`: `resource_id` como PK, `payload` jsonb con los campos editables y las relaciones (materias, niveles, áreas, palabras clave), `candidate_version_id`, `status`, `assigned_curator_id`, `created_by` y fechas.
* Las rutas de escritura de un recurso publicado escriben en la copia de trabajo. El editor la lee por encima de la proyección.
* Aprobar: aplicar `payload` con `updateResource`, mover los dos punteros, renovar el sello, borrar la copia y escribir el evento, todo en una transacción.
* Filtro «Solo validados»: parámetro `validated=true` en el buscador y la API v1 y recuento en las facetas.

## Pruebas previstas

* **Unitarios (`bun test`).** Matriz de `allowedActions` por rol, relación y estado. Motivo y lista obligatorios. Autoaprobación según la pregunta 6. `resolveLegacyCertified`. `recipientsFor`.
* **Repositorio (PGlite).** `applyEditorialAction` deshace todo si falla el evento o una notificación. 409 con dos curators a la vez. Sin notificaciones duplicadas. `removeValidation` deja su evento.
* **Rutas.** Un test por ruta de escritura que comprueba que el sello se pierde si edita el autor y se conserva si edita un curator. 403 en cada acción para los roles sin permiso. Los comentarios no aparecen en la ficha, la API v1, los feeds ni el FTS.
* **CLI.** `--mark-certified --dry-run` con los fixtures legacy (`certified` `null`, `0` y uno nuevo con `1`).
* **Correo.** El bucle con `LogEmailTransport`: un correo por notificación y reintentos.
* **e2e.** Recorrido completo: autor envía, curator pide correcciones, autor corrige y reenvía, curator aprueba y la ficha muestra «Validado». axe sobre el diálogo de motivo, la lista de comprobación, la línea de tiempo y el distintivo.
