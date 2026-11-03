# ADR-0049 Flujo de revisión editorial, comentarios privados y sello «Validado»

* Estado: Propuesto
* Fecha: 2026-11-03
* Agentes Implicados: [@.agents/skills/metadatos-y-curacion, @.agents/skills/arquitectura-solucion, @.agents/skills/evaluacion-tecnologica, @.agents/skills/backend-api-servicios, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/busqueda-y-descubrimiento, @.agents/skills/ingestas-y-migraciones]

## Contexto y Problema

Issues #496 (flujo de validación, correcciones y comunicación autor-curator) y #420 (recursos validados del Procomún antiguo). #496 pide pensar el flujo antes de implementarlo.

Cuando un autor envía un recurso a revisión, el curator solo puede publicarlo o devolverlo a borrador. No puede pedir correcciones concretas, rechazarlo con un motivo ni hablar con el autor, y no queda rastro de por qué se decidió algo. Además, un editor puede publicar sin revisión (ADR-0016), así que «publicado» no garantiza que un curator haya revisado el recurso. Por eso #420 pide un sello «Validado».

### Ya decidido (2026-11-03, @juanda)

* **#496:** sin IA por ahora (se quitó ese punto de la issue). Criterios mínimos de calidad: los campos obligatorios de #408 más licencia y accesibilidad.
* **#420:** llevan el sello «Validado» los recursos que un curator publica tras revisarlos. Los que publica directamente un editor quedan publicados, pero sin sello. Los importados con `certified` activo también lo llevan. El sello se ve en la ficha del recurso.

### Propuesto y pendiente de confirmar

* **#420** (se aplica si no se dice otra cosa): el admin cuenta como curator; el sello también sale en las tarjetas de los listados y el filtro «Solo validados» llega más adelante; si edita un curator o un admin, el recurso conserva el sello, y si lo edita su autor, lo pierde hasta que se revise de nuevo.
* **Cuestiones de #496:** las correcciones sobre un recurso publicado se hacen sobre una versión nueva y la publicada sigue a la vista hasta que se aprueba; publicar directamente sigue siendo de editor o superior; rechazar definitivamente es de curator y admin, siempre con motivo; un admin reasigna revisiones entre curators; notificaciones dentro de la aplicación y por correo si está activo, una por cambio de estado.

### Lo que hay hoy en el código

* **Estados y transiciones.** `VALID_STATUSES` (`packages/db/src/validation.ts`) son `draft`, `review`, `published` y `archived`. `TRANSITION_RULES`: `draft→review` (author), `draft→published` (editor), `review→draft` y `review→published` (curator), `published→archived` (curator) y `archived→draft` (curator). `PATCH /api/admin/resources/:id/status` comprueba `validateTransition` y, para `review` y `published`, `validateResourceForStatus` (#408: título, descripción, idioma, licencia, tipo de recurso y autor).
* **Reglas duplicadas en el frontend.** `TRANSITION_RULES` está copiada en `apps/frontend/src/pages/EditarPageBase.tsx` y en `islands/resources/ResourceEditorIsland.tsx`, con etiquetas distintas («Publicar» y «Aprobar» para lo mismo). `lib/types/editorial.ts` usa `in_review` en vez de `review`. ADR-0016 ya avisaba de esta duplicación.
* **Acceso.** `canManageResource`: el admin gestiona todo; el creador (author o superior), su recurso en cualquier estado, y el curator, lo que está en `review` o tiene como `assignedCuratorId`, salvo los borradores ajenos (#460, `isOthersPrivateDraft`, que solo mira `draft`). El editor solo gestiona lo suyo. `listResources({ hideOthersDraftsFor })` filtra con `ne(editorial_status, 'draft')`, así que el curator vería cualquier estado nuevo que no sea `draft`.
* **`assignedCuratorId` y `curatedAt` no sirven como sello.** `updateEditorialStatus` (`packages/db/src/repository/resources.ts`) pone como `assignedCuratorId` a quien hace cualquier cambio de estado, también al autor que envía a revisión y al editor que publica directamente. `curatedAt` se fija al publicar o archivar, lo haga quien lo haga. La moderación de denuncias (`routes/admin/reports.ts`) archiva con el mismo método. El importador legacy no rellena ninguno de los dos (ADR-0029) y `--fix-published` los usa como señal de «hubo revisión».
* **Sin motivo, comentarios, historial ni notificaciones.** Al cambiar de estado solo se llama a `logActivity` (`apps/api/src/activity/log.ts`), que escribe en `activity_events` el feed personal del panel («Cambiaste el estado de…»). Es «dispara y olvida»: los errores se ignoran, las filas se borran en cascada con el usuario y no hay motivo. `api_access_logs` registra peticiones HTTP para el ENS, sin semántica editorial. No hay tabla de comentarios, ni públicos ni privados, ni de notificaciones.
* **Correo.** `EmailPort` con `SmtpEmailTransport` y `LogEmailTransport` (ADR-0031, `apps/api/src/email/transport.ts`). Hoy solo se usa para verificar el correo del registro.
* **Versionado (ADR-0039).** Cada `.elpx` nuevo crea una versión y pasa a ser la vigente (`current_version_id`) en ese mismo momento. Los cambios de metadatos escriben directamente en `resources` y no crean versión. Si el recurso está publicado, la ficha usa esa proyección y `current_version_id`. No hay `published_version_id`: era la hipótesis de ADR-0028, que sigue en Propuesto. Hoy el autor de un recurso publicado lo edita en vivo y el cambio se ve en la ficha nada más guardar.
* **`certified`.** El JSON legacy lo trae como número (en los fixtures, `null` y `0`). `LegacyOdeJson` (`packages/db/src/legacy-import/types.ts`) lo declara y el mapeo no lo usa. Hay 877 recursos validados en el Procomún antiguo (#420).
* **Accesibilidad.** `resources` tiene `accessibility_features`, `accessibility_hazards` y `access_mode`, pero no los rellenan ni el editor ni la API.
* **Visibilidad pública.** Todo lo público filtra `editorial_status = 'published'`: ficha, listados, FTS, feeds y contenido `.elpx` (`routes/public.ts`, `routes/elpx-content.ts`, `social/*`). Un estado nuevo que no sea `published` queda oculto sin tocar esas consultas.
* El glosario (`docs/negocio/glosario.md`) y el mapa de capacidades ya prevén «validado» y «rechazado» como estados editoriales, y la capacidad «curador asignado».

## Opciones Consideradas

Hay siete preguntas separables.

### A. Estados

* **A1. Seguir con los cuatro estados y pedir motivo al devolver a borrador.** Cuesta poco, pero el autor no distingue su borrador de un recurso devuelto con correcciones, no hay rechazo y la cola no muestra lo pendiente del autor.
* **A2. Dos estados nuevos, `changes_requested` y `rejected` (recomendada).** «Pendiente de revisión» y «En revisión» son el mismo estado `review`, con o sin curator asignado. Es lo que distingue la issue sin multiplicar transiciones.
* **A3. Los seis estados de la issue, con `pending_review` e `in_review` separados.** Duplica transiciones para expresar algo que ya dice `assigned_curator_id`.
* **A4. Entidad de revisión aparte (`resource_reviews`) con su propio estado, como las rondas de OJS.** Más flexible, pero para un recurso sin publicar habría dos fuentes de verdad del estado. Su idea sí sirve para la fase 2 (G2): los cambios pendientes de un recurso publicado llevan su propio estado.

### B. Motor del flujo

* **B1. Propio: `TRANSITION_RULES` ampliado con acciones y tablas en PostgreSQL (recomendada).** Son una docena de transiciones, el patrón ya existe y se prueba con `bun test` y PGlite.
* **B2. Máquina de estados con XState.** Formaliza el grafo, pero añade una dependencia para una tabla que cabe en 30 líneas. No resuelve permisos, motivos ni historial.
* **B3. Motor de procesos BPMN (Camunda 8, Flowable) o de ejecución duradera (Temporal).** Infraestructura nueva, en Java en los dos primeros casos, para un flujo corto y síncrono. Descartada.
* **B4. Adoptar la capa editorial de un producto: Drupal (Content Moderation y Workflows), WordPress con PublishPress, OJS/PKP, DSpace (flujo configurable) o Strapi (Review Workflows, de pago).** Cubren estados, roles y comentarios, pero obligarían a sacar los recursos de la plataforma o a sincronizarlos. Descartada como solución. De ellos se toman patrones: las decisiones de OJS («Aceptar», «Solicitar revisiones», «Rechazar») con discusiones privadas por envío, la bolsa de tareas que el revisor reclama en DSpace y las revisiones pendientes de Drupal, con la publicada a la vista mientras se trabaja en otra (G2).

### C. Conversación privada

* **C1. Tabla propia de comentarios de revisión, solo bajo `/api/admin/` (recomendada).**
* **C2. Comentarios públicos con una marca de «privado».** No existen en el backend y mezclar público y privado en la misma tabla facilita filtrar comentarios internos a la ficha. Descartada.
* **C3. Fuera de la plataforma (correo, helpdesk tipo OTRS o Zammad, issues).** Se pierde el vínculo con el recurso y su estado, y los datos salen de la plataforma. Descartada.

### D. Historial y auditoría

* **D1. Tabla propia `resource_editorial_events`, append-only y escrita en la misma transacción que el cambio (recomendada).**
* **D2. Reutilizar `activity_events`.** Es el feed personal: se pierde si falla, se borra con el usuario y no guarda motivo ni versión. Se mantiene para el panel, pero no sirve como auditoría.
* **D3. `api_access_logs`.** Solo registra peticiones HTTP. Descartada.
* **D4. Event sourcing del recurso (opción C de ADR-0028).** Excesivo para lo que se pide.

### E. Notificaciones

* **E1. Tabla propia `notifications`, avisos dentro de la aplicación y correo por `EmailPort` con bandeja de salida (recomendada).** El correo pendiente se envía en un bucle de la API, con el mismo patrón que ADR-0046 (B1).
* **E2. Novu, plataforma abierta de notificaciones, alojada por nosotros.** Trae bandeja y plantillas, pero necesita MongoDB y Redis y es un servicio más para cuatro tipos de aviso.
* **E3. SaaS de notificaciones (Knock y similares).** Datos personales y de la Administración fuera de nuestra infraestructura (ENS, ADR-0015) y dependencia de un proveedor. Descartada.
* **E4. Solo correo.** Si no hay SMTP, el autor no se entera. No cumple «notificaciones dentro de la aplicación».

### F. Cómo se guarda el sello

* **F1. Deducirlo de `assignedCuratorId` y `curatedAt`.** Descartada: hoy los rellena quien haga cualquier cambio de estado, también el autor y el editor, y no existen en los importados.
* **F2. Columnas propias en `resources`: `validated_at`, `validated_by` y `validation_source` (recomendada).** Se lee sin coste en listados y filtros, y cada cambio queda en el historial.
* **F3. Deducirlo del historial de eventos.** Es correcto, pero obliga a consultar eventos en cada tarjeta y en el filtro. El historial sigue siendo la prueba, y la columna, la proyección.
* **F4. Una etiqueta o taxonomía «validado».** Sin control de quién la pone ni rastro. Descartada.

### G. Correcciones sobre un recurso ya publicado

* **G1. Edición en vivo, como hoy, más el sello.** El autor edita el recurso publicado y el cambio se ve al guardar. Si no es curator ni admin, el recurso pierde el sello. Para recuperarlo pide una validación. Cuesta poco y aplica la regla de #420 tal cual.
* **G2. Cambios pendientes (la propuesta de #496).** Mientras el autor corrige, la ficha sigue con la versión publicada, y la nueva se publica al aprobarla. Hace falta lo que hoy no existe: un puntero `published_version_id` distinto de `current_version_id` y una copia de trabajo de los metadatos, porque los cambios de metadatos no crean versión (ADR-0039). Cambia todas las rutas de escritura del editor y los puntos 2 y 3 de ADR-0039.

## Decisión

Propuesta: **A2 + B1 + C1 + D1 + E1 + F2**, con **G1 en la fase 1 y G2 en la fase 2**. Lo marcado como «pendiente» depende de las preguntas abiertas del final.

### 1. Estados

`VALID_STATUSES` pasa a ser `draft`, `review`, `changes_requested`, `rejected`, `published` y `archived`.

| Estado | Etiqueta | Público |
|---|---|---|
| `draft` | Borrador | No (privado del autor, #460) |
| `review` sin curator asignado | Pendiente de revisión | No |
| `review` con curator asignado | En revisión | No |
| `changes_requested` | Correcciones solicitadas | No |
| `rejected` | Rechazado | No |
| `published` | Publicado (y, si tiene sello, «Validado») | Sí |
| `archived` | Archivado | No |

### 2. Transiciones por rol (fase 1)

| Desde | Acción | Hacia | Quién | Motivo | Sello |
|---|---|---|---|---|---|
| `draft` | Enviar a revisión | `review` | creador (author o superior) | — | — |
| `draft` | Publicar directamente | `published` | creador con rol editor o superior; admin | — | No |
| `review` | Revisar (asignármelo) | `review` | curator, admin | — | — |
| `review` | Reasignar | `review` | admin | opcional | — |
| `review` | Aprobar y publicar | `published` | curator, admin ¹ | lista de comprobación | Sí |
| `review` | Solicitar correcciones | `changes_requested` | curator, admin | obligatorio | — |
| `review` | Rechazar | `rejected` | curator, admin | obligatorio | — |
| `review` | Retirar de revisión | `draft` | creador | opcional | — |
| `changes_requested` | Reenviar a revisión | `review` | creador | opcional (respuesta) | — |
| `changes_requested` | Publicar directamente | `published` | creador con rol editor o superior | — | No |
| `rejected` | Reabrir | `draft` | admin | obligatorio | — |
| `published` | Solicitar validación | `published` | creador | — | — |
| `published` | Validar | `published` | curator, admin ¹ | lista de comprobación | Sí |
| `published` | Solicitar correcciones (validación pedida) | `published` | curator, admin | obligatorio | — |
| `published` | Archivar | `archived` | curator, admin | obligatorio | se conserva, no se ve |
| `archived` | Restaurar a borrador | `draft` | curator, admin | — | se pierde |

¹ Pendiente: si un curator o un admin puede aprobar su propio recurso (pregunta 6). La propuesta es que no.

* Desaparece «Devolver a borrador» del curator (`review→draft`). Lo sustituye «Solicitar correcciones», que exige motivo.
* «Enviar a revisión», «Reenviar a revisión», «Aprobar y publicar» y «Publicar directamente» siguen pasando por `validateResourceForStatus` (#408). `changes_requested` y `rejected` no exigen nada.
* «Revisar» y «Aprobar» en `review` los puede hacer cualquier curator. Aprobar se asigna el recurso a quien aprueba. Solo el admin reasigna uno que ya tiene curator.

### 3. Curator asignado

`assigned_curator_id` pasa a ser el curator responsable de la revisión en curso. Lo cambian solo «Revisar», «Reasignar» y las decisiones de un curator o un admin, no el envío del autor ni la publicación directa del editor. `curated_at` queda como fecha de la última decisión de un curator. El acceso que hoy da `assignedCuratorId` (DEF-009, #205) se mantiene.

### 4. Quién edita en cada estado

| Estado | Creador | Curator o admin |
|---|---|---|
| `draft` | edita | solo el admin (#460) |
| `review` | solo lectura; puede retirarlo | edita correcciones menores y comenta |
| `changes_requested` | edita, comenta y reenvía | lee y comenta |
| `rejected` | lee; puede borrarlo | el admin lo reabre |
| `published` | edita en vivo (G1); si no es curator ni admin, el recurso pierde el sello | edita y el recurso conserva el sello |
| `archived` | lee | edita y restaura |

El bloqueo del creador en `review` está pendiente (pregunta 7). Se aplica con una función nueva, `canEditResource`. `canManageResource` sigue decidiendo quién lee y gestiona.

### 5. Criterios mínimos de calidad

* **Automáticos.** Bloquean el envío y ya existen (#408): título, descripción, idioma, licencia, tipo de recurso y autor. El área de conocimiento se añade cuando entre #448 (PR #513).
* **Lista de comprobación del curator.** Se marca al aprobar o validar: (1) los metadatos describen bien el recurso; (2) la licencia es coherente con el contenido, incluidas la licencia y la procedencia de las imágenes y los materiales de terceros; (3) accesibilidad básica: texto alternativo en las imágenes, subtítulos o transcripción en vídeo y audio, y contraste y estructura legibles. Para aprobar hay que marcarlos todos. Lo marcado se guarda en el evento. Si falla alguno, el curator pide correcciones y señala el aspecto. La lista la cierra el equipo editorial.

### 6. Hilo privado de revisión

* Tabla `resource_review_comments`, con un hilo por recurso que dura todas las rondas. Cada comentario guarda autor, rol en ese momento, fecha, versión vigente, estado y, si se quiere, un aspecto: `content`, `accessibility`, `license`, `metadata`, `sources` u `other`.
* Texto plano, de 1 a 5000 caracteres, que se muestra como texto y nunca como HTML. No se edita ni se borra.
* Leen y escriben el creador, el admin y los curators que pueden ver el recurso fuera de borrador (`canAccessReviewThread`, con la misma regla que `canViewResource` sin la parte pública).
* **Nunca es público.** Solo se sirve bajo `/api/admin/`. No entra en la ficha, la API v1, los feeds, el `search_vector`, las exportaciones ni el `.elpx`. Los tests lo comprueban.
* El motivo de cada decisión (corregir, rechazar, archivar, reabrir) se guarda en el evento y sale en la misma línea de tiempo que los comentarios. El autor lee el motivo donde está la conversación.

### 7. Historial para auditoría

* Tabla `resource_editorial_events`, append-only, que se escribe en la misma transacción que el cambio: si falla el evento, falla el cambio. Guarda acción, estado de origen y de destino, actor, rol en ese momento, motivo, versión vigente (`current_version_id`), detalles (lista de comprobación, curator asignado, causa) y fecha.
* En los envíos, las aprobaciones y las validaciones guarda además una instantánea de los metadatos, con la forma de `resource_versions.metadata_snapshot`. Así el curator ve qué cambió entre una ronda y la siguiente aunque no haya `.elpx` nuevo, porque ADR-0039 no versiona los cambios de metadatos.
* Lo ven las mismas personas que el hilo. `activity_events` sigue para el panel personal.

### 8. Notificaciones

* Tabla `notifications`, con una fila por destinatario. La campana de la cabecera muestra los no leídos y hay una página «Notificaciones» para marcarlos como leídos.
* **Quién recibe qué:**

| Evento | Destinatario | Correo |
|---|---|---|
| Solicitar correcciones, aprobar y publicar, rechazar, validar, archivar, reabrir | creador | sí |
| Reenviar a revisión, retirar de revisión | curator asignado, si lo hay | sí |
| Revisar o reasignar | curator que pasa a tenerlo asignado, si no es quien actúa | sí |
| Solicitar validación | curator asignado, si lo hay | sí |
| Comentario nuevo | la otra parte: el creador o el curator asignado | no |
| Envío sin curator asignado | nadie: sale en la cola y en el contador del panel | — |

* **Sin duplicados:** como mucho una notificación por evento y destinatario (`UNIQUE (user_id, event_id)` y `UNIQUE (user_id, comment_id)`), nunca a quien hace la acción y como mucho un correo por notificación.
* **Correo:** solo si hay SMTP (ADR-0031), si la variable nueva `NOTIFICATIONS_EMAIL` vale `true` (por defecto `false`) y si el usuario no lo ha desactivado en su perfil. La notificación nace en la misma transacción con `email_status = 'pending'` y un bucle de la API la envía (`FOR UPDATE SKIP LOCKED`, hasta 3 intentos), igual que ADR-0046 (B1). El correo dice qué decisión se tomó, el título del recurso y el enlace al editor. Está pendiente si incluye el texto del motivo (pregunta 5).

### 9. Sello «Validado»

* Columnas nuevas en `resources`: `validated_at` (timestamp), `validated_by` (FK a `user`, `ON DELETE SET NULL`) y `validation_source` (`review` o `legacy`). Un recurso está validado si `validated_at IS NOT NULL`.
* **Se pone** al «Aprobar y publicar» o «Validar» (curator o admin) y al importar un recurso legacy con `certified` (punto 10).
* **Se quita** cuando el creador, sin rol curator ni admin, cambia el contenido o los metadatos públicos de un recurso publicado: metadatos, `.elpx` nuevo (subida, guardado desde el editor o generación), adjuntos, palabras clave y áreas. También se quita al restaurar un archivado a borrador. Cada vez queda un evento `validation_removed` con la causa. Antes de guardar, el editor avisa: «Este recurso tiene el sello Validado. Si guardas los cambios, lo perderá hasta que un curator lo revise de nuevo».
* **Se conserva** con las ediciones de un curator o un admin, al restaurar una versión (ADR-0039: solo pueden hacerlo ellos) y al archivar, aunque mientras está archivado no se ve.
* **Dónde se ve:** en la ficha, como distintivo «Validado» con su fecha y la explicación «Revisado por el equipo de curación de Procomún». En los importados, sin fecha. También en las tarjetas de los listados. La API v1 y los feeds exponen `validated` y `validatedAt`. No se muestra quién lo validó (pregunta 12).

### 10. Importados con `certified`

* `certified` se normaliza como `published` (`resolveLegacyPublicationStatus`): `1`, como número o como texto, cuenta como validado. El valor está pendiente de confirmar (pregunta 10).
* Se pone el sello (`validation_source = 'legacy'`, `validated_by` nulo) solo si el recurso entra como `published`. Los certificados que entran como borrador salen en el informe (`certifiedNotPublished`) sin sello.
* Para lo ya importado, `import:legacy-procomun --mark-certified --source-dir <ruta> [--dry-run] [--report-dir <ruta>]`, como `--fix-published` y `--link-authors`. Solo marca recursos publicados sin sello y sin cambios desde la importación. Cómo se detecta un cambio (`updated_at` frente a `imported_at`, o el historial) se decide al implementarlo. Nunca quita un sello y repetirlo no cambia nada. El informe da los totales.

### 11. Correcciones sobre un recurso publicado

* **Fase 1 (G1).** El recurso se sigue editando en vivo. Si lo edita el creador sin ser curator ni admin, pierde el sello. «Solicitar validación» guarda `validation_requested_at` y lo pone en la pestaña «Validación solicitada» de la cola. El curator lo valida o pide correcciones, con motivo y sin despublicarlo, y la solicitud se cierra.
* **Fase 2 (G2, la propuesta de #496, pendiente de confirmar).** Los cambios a un recurso publicado van a una copia de trabajo, `resource_pending_changes`: una por recurso, con los metadatos editables, la versión candidata, su propio estado (`draft`, `review`, `changes_requested`, `rejected`) y el curator asignado. Mientras existe, el editor trabaja sobre ella. La ficha sigue con la proyección de `resources` y con `published_version_id`, un puntero nuevo. Un `.elpx` nuevo crea su versión, así que el historial de ADR-0039 no cambia, pero no pasa a la ficha hasta que se aprueba. Al aprobar, en una transacción: se aplican los metadatos, `published_version_id` y `current_version_id` pasan a la candidata, el sello se renueva, se borra la copia y queda el evento. Si un editor la publica directamente, se aplica sin sello. Hay que ajustar ADR-0039 (puntos 2 y 3) y las rutas que resuelven el `.elpx` público (`elpx-projects.ts`, `elpx-content.ts` y la cookie de vista previa de #466).

### 12. API

* `POST /api/admin/resources/:id/editorial-actions` con `{ action, reason?, checklist?, curatorId? }`. En una transacción comprueba rol, estado, motivo, lista y campos (#408), y escribe el recurso, el evento y las notificaciones. Devuelve el estado nuevo y `allowedActions`.
* `GET /api/admin/resources/:id/editorial`: estado, curator asignado, sello, `allowedActions` y línea de tiempo (eventos y comentarios).
* `POST /api/admin/resources/:id/review-comments` con `{ body, aspect? }`.
* Cola: `GET /api/admin/review-queue?view=unassigned|mine|changes_requested|validation_requested`, ordenada por antigüedad del envío.
* `GET /api/admin/notifications`, `POST /api/admin/notifications/:id/read` y `POST /api/admin/notifications/read-all`.
* `allowedActions` sale de la misma función que valida en el servidor. El frontend deja de copiar `TRANSITION_RULES` y se corrige `in_review`. `PATCH /:id/status` se mantiene mientras el frontend migra, solo para las transiciones que no piden motivo, y después se retira.

### 13. Búsqueda, metadatos y moderación

* **Búsqueda.** En la fase 1 no cambia nada público: los estados nuevos no son públicos y `validated_at` entra en la selección de listados para pintar el sello. En la fase 2 llega el filtro «Solo validados» (`?validated=true`, índice parcial sobre `validated_at IS NOT NULL` y recuento en las facetas), sin subir a los validados en la relevancia (pregunta 13). Los comentarios nunca entran en el `search_vector`.
* **Metadatos.** El sello es un dato de la plataforma, no un campo descriptivo. Cuando haya exportación LOM-ES, irá en `metaMetadata.contribute` con el rol `validator` y la organización como entidad, no una persona.
* **Moderación.** Archivar por una denuncia (`routes/admin/reports.ts`) pasa por la misma acción, con la resolución como motivo, y deja evento y notificación. «Rechazado» es una decisión de calidad. La retirada por incumplir las normas sigue siendo archivar.
* **Analítica.** Con los eventos se pueden medir el tiempo hasta la decisión, las rondas por recurso y la tasa de rechazo. Se definirá más adelante.

### 14. Accesibilidad (WCAG 2.2 AA)

* El sello y los estados se identifican por texto, no solo por color o icono. El icono lleva `aria-hidden` y el contraste usa los tokens de DESIGN.md (ADR-0022).
* «Solicitar correcciones», «Rechazar», «Archivar» y «Reabrir» abren un diálogo con foco gestionado y un campo de motivo con etiqueta, `aria-required` y el error asociado con `aria-describedby`. La lista de comprobación es un `fieldset` con `legend`.
* La línea de tiempo es una lista ordenada. Cada entrada lleva autor, rol, `<time datetime>` y aspecto en texto.
* La campana tiene nombre accesible con el número de no leídos («Notificaciones, 3 sin leer»). Los avisos no dependen solo de mensajes emergentes y el resultado de cada acción se anuncia con `role="status"`.
* El correo va en texto plano, con una versión HTML sencilla.

## Consecuencias

### Positivas

* El autor sabe por qué no se publica su recurso y qué tiene que corregir, sin salir de la plataforma.
* El sello significa una sola cosa: un curator o un admin revisó el contenido que se ve. No depende de campos que rellena cualquiera.
* Queda un historial completo y transaccional de quién decidió qué, cuándo y por qué (ENS, trazabilidad).
* Se acaba la duplicación de reglas entre el servidor y dos componentes del frontend.
* No hay servicios nuevos. Se reutilizan `EmailPort` (ADR-0031), el patrón de bucle de ADR-0046 y el versionado de ADR-0039.
* Los 877 recursos validados del Procomún antiguo conservan su reconocimiento.

### Negativas / Riesgos

* **Muchas rutas de escritura.** Quitar el sello obliga a cubrir cada ruta que cambia contenido público (metadatos, `.elpx`, adjuntos, etiquetas, áreas). Si se olvida una, el sello se queda en un contenido que nadie revisó. Mitigación: un único punto de paso (`onPublicContentChanged`) y un test por ruta.
* **Cambio de significado de `assigned_curator_id`.** Quien dependa de que lo rellene cualquier transición dejará de tenerlo. Hay que revisar `canManageResource`, `keepsAccessAfterStatusChange` (frontend) y `--fix-published`.
* **Edición en vivo en la fase 1.** Hasta la fase 2, lo que cambia el autor de un recurso publicado se ve sin revisión. Sale sin sello, que es justo la señal que pide #420.
* **Coste de la fase 2.** Los cambios pendientes tocan el editor, las rutas del `.elpx` público y ADR-0039. Es la parte más cara y conviene confirmarla antes de empezarla.
* **Ruido.** Notificar mal satura. Mitigación: tabla de destinatarios cerrada, sin correo por comentario y sin avisar a todos los curators de cada envío.
* **Datos personales.** Los comentarios y el historial son datos de actividad (`docs/epics/ens/evaluacion-rgpd.md`). Al borrar un usuario, sus comentarios quedan como «Usuario eliminado» (`ON DELETE SET NULL`). Hay que añadirlo al registro de tratamientos.
* **Lock-in.** Bajo: tablas propias en PostgreSQL y SMTP estándar.

## Notas de Implementación

* No se implementa nada hasta que el usuario cierre las preguntas abiertas. Diseño y tareas: `docs/epics/epic-001-mvp-recursos-metadatos-minimos/features/feature-revision-editorial-sello-validado/`.
* **Fases.** 1a: estados, acciones, historial y comentarios. 1b: sello e importados. 1c: interfaz (acciones, hilo, cola y sello en la ficha y las tarjetas). 1d: notificaciones y correo. 2: filtro «Solo validados» y cambios pendientes (G2).
* **Migración.** Una para las columnas de `resources` y las tablas nuevas. Su número se elige al implementarla: en `main` la última es la `0014`, y los PR abiertos ya ocupan de la `0015` a la `0018`. También hay que añadirlas a `setup.ts` para PGlite y la vista previa.
* **Validación (regla 14).** Tests de la matriz de transiciones por rol, con los motivos obligatorios y la autoaprobación. Un test de que, si falla el evento, se deshace el cambio de estado. Tests de que los comentarios no salen en la ficha, la API v1, los feeds ni el FTS. Un test por ruta que pone o quita el sello. Tests de `certified` en el mapeo y en `--mark-certified --dry-run`, de las notificaciones sin duplicados y del correo con `LogEmailTransport`. Un e2e del recorrido completo: enviar, pedir correcciones, reenviar y aprobar con sello. axe sobre los diálogos, el hilo y el sello.
* **Relación con otras ADR.** Amplía ADR-0008 (roles), ADR-0016 (publicación directa del editor), ADR-0029 (`certified`) y ADR-0031 (correo). La fase 2 cambia ADR-0039 y retoma `published_version_id` de ADR-0028. Toma el patrón de bucle de ADR-0046.
* **Fuera de alcance.** Revisión de colecciones, IA (decidido) y comentarios públicos.

## Preguntas abiertas para el equipo

1. **Correcciones sobre publicados:** ¿de acuerdo con edición en vivo en la fase 1 (el autor pierde el sello) y cambios pendientes en la fase 2?
2. **Publicar directamente:** editor o superior, como hoy. ¿También desde «Correcciones solicitadas»? La propuesta es que sí, sin sello.
3. **Rechazo:** curator y admin, siempre con motivo. ¿Es definitivo? La propuesta es que solo el admin lo reabra y que el autor no pueda editarlo.
4. **Reasignación:** la hace el admin. ¿Puede un curator coger un recurso ya asignado a otro?
5. **Notificaciones:** dentro de la aplicación y por correo, una por cambio de estado. ¿El correo incluye el texto del motivo o solo el enlace? ¿El correo está activado por defecto en el perfil?
6. **Autoaprobación:** ¿puede un curator o un admin aprobar o validar su propio recurso? La propuesta es que no.
7. **Edición en revisión:** ¿se bloquea al autor mientras su recurso está en `review`?
8. **Accesibilidad como criterio:** ¿basta con la lista de comprobación del curator o se piden los metadatos de accesibilidad (`accessibility_features` y demás, hoy sin formulario)?
9. **Validar un publicado:** ¿puede un curator dar el sello a un recurso ya publicado, como los que publicó un editor, sin que pase por `review`? La propuesta es que sí.
10. **`certified`:** ¿qué valor cuenta como validado? La propuesta es `1`. ¿Llevan sello los certificados que entran como borrador?
11. **Lo ya aprobado en la plataforma nueva:** ¿se recupera el sello de los recursos que un curator publicó desde `review`, a partir de `activity_events`? Es posible para lo que siga en esa tabla, con un informe previo.
12. **Quién validó:** ¿se muestra en la ficha? La propuesta es que no: solo «Validado» y la fecha.
13. **Relevancia:** ¿suben los validados en los resultados? La propuesta es que no por ahora.
