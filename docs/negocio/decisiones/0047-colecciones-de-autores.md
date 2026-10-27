# ADR-0047 Colecciones de autores junto a las colecciones editoriales

* Estado: Propuesto
* Fecha: 2026-10-27
* Agentes Implicados: [@.agents/skills/empresa-y-producto, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/busqueda-y-descubrimiento]

## Contexto y Problema

La issue #433 pregunta por qué solo `curator` y `admin` pueden crear colecciones. Negocio entiende que serán los autores quienes más colecciones creen.

Hoy la documentación y el código no dicen lo mismo:

* **ADR-0008** da a `author` permiso para crear colecciones y editar las suyas, y a `curator` y `admin` para borrarlas.
* **ADR-0016** dice que `editor` hereda del author «crear, leer, actualizar recursos y colecciones propias».
* **La feature de colecciones públicas** (`docs/epics/epic-003/features/feature-colecciones-publicas-y-gestion/`) las trató como curación editorial y subió el mínimo a `curator`. Es lo que hay en el código: `buildCrudRoutes({ baseRole: "curator" })` en `apps/api/src/routes/admin/collections.ts`, y `canManageCollection` (`apps/api/src/auth/roles.ts`) deja a cualquier curator gestionar cualquier colección, sin mirar `curatorId`. `permissions.ts` sigue dando `collection:create/update` a author y editor, pero no llegan a usarlo.

Además, la revisión de #463 (#460, borradores privados frente al curator) dejó pendiente un hueco: `GET /api/admin/collections/:id/resources` no filtra por estado ni por creador (`packages/db/src/repository/collection-resources.ts`, `listCollectionResources`). Un curator ve título, descripción y autor de un borrador ajeno si está en una colección. Pasa cuando un curator añade a una colección un borrador suyo, o cuando el recurso se añadió estando en revisión y luego volvió a borrador.

Negocio (Alejandro, en #433) ha decidido:

1. Una colección de autor puede incluir **cualquier recurso publicado**, no solo los suyos.
2. La colección de un autor **pasa por revisión** antes de ser pública. El autor la ve mientras tanto. Un `editor` la publica directamente.
3. El autor elige si su colección es **pública o privada**.
4. **Editan y borran todos**: el autor, el curator y el admin.
5. Las colecciones **editoriales se distinguen** de las de autores. Propuesta de erseco en #433, que esta ADR recoge:
   * En la tarjeta, una etiqueta: «Colección editorial» o «Colección de <autor>», con el nombre enlazado a su ficha (#458).
   * En portada, dos bloques: primero las editoriales y después las de autores.
   * En el listado de colecciones, un filtro por tipo (editoriales o de autores).
   * Las privadas solo las ven su autor y el admin. No salen en portada, ni en búsquedas, ni en la ficha del autor.

## Opciones Consideradas

* **Opción 1: mantener las colecciones solo para curator y admin** y corregir ADR-0008 y ADR-0016 para que digan lo que hace el código. Contradice lo que pide negocio.
* **Opción 2: abrir la creación a author y editor sin distinguir tipos.** Todas iguales en portada y listado. No cumple la decisión 5 y mezcla la curación editorial con las listas de cada docente.
* **Opción 3: un solo modelo de colección con dos campos nuevos, tipo (`editorial` / `author`) y visibilidad (`public` / `private`), y el estado editorial que ya existe con un flujo de revisión.** La misma tabla, la misma API y el mismo backoffice para todos los roles; los permisos dependen del rol, del propietario, del tipo, de la visibilidad y del estado.
* **Opción 4: dos entidades distintas**, colecciones editoriales y «listas» de autores, con tablas y rutas separadas. Duplica el CRUD, la ordenación, los feeds y la vista pública, y obliga a migrar si una lista de autor acaba siendo editorial.

## Decisión

**Opción 3.** Las colecciones de autores y las editoriales comparten modelo, API y pantallas. Lo que las distingue son dos campos y una regla de permisos que vive en un solo sitio, como la de los recursos (#463).

### Modelo de datos

Cambios en `collections` (`packages/db/src/schema/collections.ts`), en una migración nueva:

| Campo | Tipo | Valores | Notas |
|---|---|---|---|
| `kind` | `varchar(20) NOT NULL DEFAULT 'editorial'` | `editorial`, `author` | Lo fija el servidor según el rol al crearla (ver abajo). |
| `visibility` | `varchar(20) NOT NULL DEFAULT 'public'` | `public`, `private` | La elige el propietario. |
| `owner_id` | `text NOT NULL` → `user.id` | | Renombra `curator_id`: es quien la creó y la mantiene, no siempre un curator. |
| `editorial_status` | ya existe | `draft`, `review`, `published`, `archived` | Se añade `archived`. Solo se aplica a las públicas. |
| `reviewed_by` | `text NULL` → `user.id` | | Quien la aprobó o la devolvió a borrador. |
| `reviewed_at`, `published_at` | `timestamp NULL` | | Para la cola de revisión y para ordenar en portada. |

En `collection_resources` se añade una restricción única `(collection_id, resource_id)`. Hoy el duplicado solo se comprueba en la ruta.

Reglas:

* **Tipo.** Lo que crean `author` y `editor` es siempre `author`. Lo que crean `curator` y `admin` es `editorial`. El tipo no se cambia desde la API en esta fase (ver preguntas abiertas).
* **Privadas.** Una colección `private` no entra en el flujo editorial: su estado no se muestra ni se usa, y nadie salvo su propietario y el admin la ve. Las editoriales son siempre públicas.
* **Flujo de las públicas de autor:**
  * `author`: `draft → review → published`. El curator aprueba (`review → published`) o la devuelve (`review → draft`).
  * `editor`: `draft → published` directamente, solo en las suyas, igual que con sus recursos (ADR-0016).
  * `curator` y `admin`: `published → archived` y `archived → draft`, en cualquier colección pública.
  * Las transiciones se declaran en una tabla `COLLECTION_TRANSITION_RULES` en `packages/db/src/validation.ts`, como `TRANSITION_RULES` de los recursos, y pasan por un endpoint propio. El `PATCH` general deja de aceptar `editorialStatus`, que hoy permite publicar sin pasar por ninguna regla.
* **Cambio de visibilidad:**
  * De privada a pública: entra en `draft`. Un author la envía a revisión y un editor la publica.
  * De pública a privada: se permite en cualquier estado y la retira de inmediato de portada, listados, búsqueda y feeds.
* **Editoriales:** las crean curator y admin y las publican ellos, sin revisión de otra persona, como hasta ahora.

### Matriz de permisos

«Propia» es una colección cuyo `owner_id` es el usuario. «Pública visible» es una colección pública en `published`.

| Acción | reader (anónimo) | author | editor | curator | admin |
|---|---|---|---|---|---|
| Crear | — | sí, tipo `author` | sí, tipo `author` | sí, tipo `editorial` | sí, tipo `editorial` |
| Ver | públicas visibles | públicas visibles y todas las propias | ídem author | propias y las públicas ajenas que no estén en `draft` (`review`, `published`, `archived`) | todas, también las privadas |
| Editar (título, descripción, portada, orden) | — | propias | propias | propias y las públicas ajenas que no estén en `draft` | todas |
| Borrar | — | propias | propias | propias y las públicas ajenas que no estén en `draft` | todas |
| Enviar a revisión | — | propias públicas | — (publica directamente) | — | — |
| Publicar | — | — | propias públicas, sin revisión | aprobar las que están en `review`; propias | todas |
| Devolver a borrador, archivar | — | — | — | públicas ajenas en `review`/`published`, y propias | todas |
| Añadir recursos | — | a las propias, solo recursos publicados | ídem author | a las que puede editar, recursos que puede ver (`canViewResource`) | a todas, cualquier recurso |
| Quitar y reordenar recursos | — | propias | propias | las que puede editar | todas |

Notas:

* La decisión 4 («editan y borran todos») se aplica a las colecciones públicas que el curator puede ver. Un curator **no** ve ni toca las colecciones privadas de otros ni las que otro usuario tiene en `draft`, por la misma razón que los borradores de recursos (#460): son trabajo privado de su autor. El admin lo ve todo.
* Las mismas reglas se aplican a las editoriales en `draft` de otro curator. Lo que hoy hace `canManageCollection` (cualquier curator, cualquier colección) cambia: es lo que #460 dejó para esta issue.
* Un author no puede añadir a una colección sus propios recursos sin publicar. La decisión 1 habla de «cualquier recurso publicado», y así una colección no se convierte en una vía para enseñar borradores.

La regla vive en `packages/db/src/validation.ts`, junto a `canViewResource` e `isOthersPrivateDraft`:

* `canViewCollection(user, collection)` para leer.
* `canManageCollection(user, collection)` para editar, borrar, añadir, quitar y reordenar (sustituye a la de `apps/api/src/auth/roles.ts`).
* `canTransitionCollection(user, collection, to)` para el estado.
* Una versión SQL para los listados, `listCollections({ visibleTo })`, como `hideOthersDraftsFor` en los recursos.

El frontend importa las mismas funciones para mostrar u ocultar botones.

### Recursos dentro de una colección

`GET /api/admin/collections/:id/resources` filtra los recursos con la misma regla de visibilidad que el resto: se devuelve un recurso solo si `canViewResource(user, recurso)`. En SQL, `listCollectionResources(db, id, { visibleTo: user })` aplica la condición de `listResources({ hideOthersDraftsFor })` y, para author y editor, la limita a recursos publicados o propios. Así se cierra el hueco de #463 tanto en las colecciones editoriales como en las de autores.

La relación no se borra cuando un recurso deja de ser visible. El listado devuelve también cuántos recursos quedan ocultos (`hiddenCount`) para que el propietario sepa que su colección tiene huecos, sin ver de qué recursos se trata.

Un recurso que se despublica, se archiva o vuelve a borrador **estando en una colección pública** desaparece de la vista pública de la colección (ya ocurre: `listPublishedCollectionResources` filtra por `published`) y vuelve si se publica otra vez. Si se borra de forma definitiva, la relación cae en cascada.

### Visibilidad pública

Solo las colecciones públicas en `published` salen fuera del backoffice:

| Lugar | Editoriales | De autores | Privadas |
|---|---|---|---|
| Portada | primer bloque | segundo bloque, las publicadas más recientes | nunca |
| `/colecciones` (listado y búsqueda) | sí | sí | nunca |
| Filtro por tipo en `/colecciones` | «Editoriales» | «De autores» | — |
| Ficha del autor (#458) | — | bloque «Colecciones de <autor>» con las suyas públicas | nunca |
| Detalle `/colecciones?slug=…` y feed Atom | sí | sí | 404 (también para su autor fuera del backoffice) |
| Recomendaciones (`collectionCooccurrence`) | sí | sí | nunca |

* **Tarjeta:** etiqueta de texto «Colección editorial» o «Colección de <autor>», con el nombre enlazado a la ficha del autor (#458). La distinción no depende solo del color (WCAG 1.4.1).
* **Recomendaciones:** hoy `apps/api/src/recommendations/service.ts` cuenta la coincidencia en cualquier colección, también en borradores. Pasa a contar solo colecciones públicas publicadas. Con las privadas sería una fuga: dejaría deducir qué guarda un usuario en sus listas.
* **Colecciones vacías:** una colección publicada sin ningún recurso publicado no sale en portada (ver preguntas abiertas para el listado).

### Migración

* Todas las colecciones existentes las crearon curator o admin, así que pasan a `kind = 'editorial'`, `visibility = 'public'`, con su estado actual. `owner_id` toma el valor de `curator_id`.
* La migración es solo de esquema y valores por defecto. No hay datos que transformar.
* El seed (`DEMO_COLLECTIONS` en `packages/db/src/seed-data.ts`) añade al menos una colección de autor pública en revisión, una publicada y una privada, para las pruebas y la demo.
* El Procomún antiguo tiene `collectionNameStr` en los recursos (`packages/db/src/legacy-import/types.ts`), que hoy no se importa. Esta ADR no cambia eso.

### Impacto en la API

* `apps/api/src/routes/admin/collections.ts`:
  * `baseRole` baja de `curator` a `author`.
  * El listado filtra con `listCollections({ visibleTo })`.
  * `prepareCreate` fija `kind` según el rol y `ownerId = user.id`. Admite `visibility`.
  * El `PATCH` deja de aceptar `editorialStatus` y `kind`.
  * Nuevo `PATCH /api/admin/collections/:id/status` con `canTransitionCollection`.
  * `GET /:id/resources` filtra por visibilidad y devuelve `hiddenCount`.
  * `POST /:id/resources` comprueba `canManageCollection` y, para author y editor, que el recurso esté publicado (404 en otro caso, como hoy con un borrador ajeno).
* `apps/api/src/auth/permissions.ts`: author y editor reciben `collection:delete`. La propiedad la comprueba `canManageCollection`, igual que con los recursos.
* `GET /api/v1/collections` admite `kind=editorial|author` y `ownerId` (para la ficha del autor). Las respuestas incluyen `kind`, `ownerId` y `ownerName`. `curatorName` se mantiene un tiempo como alias de `ownerName` para no romper el frontend durante la transición.
* Registro de actividad: nuevos tipos para enviar a revisión, publicar, devolver a borrador y archivar una colección.

### Impacto en el frontend

* Backoffice: la sección de colecciones aparece para author y editor, como «Mis colecciones» (`AdminSidebar.tsx`, `admin-sections.ts`).
* `CollectionsCrudIsland.tsx`: campo de visibilidad, botones «Enviar a revisión» o «Publicar» según el rol, y el selector de recursos limitado a recursos publicados para author y editor.
* Cola de revisión de colecciones para curator y admin en el panel (`AdminDashboardSection.tsx`).
* Tarjeta de colección con la etiqueta de tipo; dos bloques en portada (`HomeDataIsland.tsx`); filtro por tipo en `PublicCollectionsIsland.tsx`; bloque de colecciones en la ficha del autor cuando exista (#458).
* Textos nuevos en los mensajes de Paraglide; todo control nuevo con etiqueta accesible y operable por teclado.

## Consecuencias

### Positivas
* Los autores pueden organizar y compartir recursos, que era lo que pedía #433.
* Un solo modelo: la migración es pequeña y no se duplican CRUD, feeds ni vista pública.
* ADR-0008, ADR-0016 y el código vuelven a decir lo mismo sobre quién crea colecciones.
* La visibilidad de colecciones y de sus recursos sigue la misma regla que la de los recursos (#460, #463), en un solo sitio y compartida con el frontend.
* Se corrigen dos fugas que ya existen: los borradores ajenos en `GET /api/admin/collections/:id/resources` y las colecciones en borrador en las recomendaciones.
* El `PATCH` deja de permitir publicar una colección sin pasar por las reglas de transición.

### Negativas / Riesgos
* **Carga de revisión.** Cada colección pública de un author pasa por un curator. Si hay muchas, la cola crece. Mitigación: límites (ver preguntas abiertas) y que los editores publiquen directamente.
* **Abuso y calidad.** Títulos o descripciones inapropiados en colecciones de autores ya publicadas. Hoy las denuncias (`reports`) solo admiten recursos.
* **Privacidad.** Una colección privada dice qué recursos guarda un usuario. Es un dato personal de poco riesgo, pero no debe salir en recomendaciones, búsquedas ni estadísticas, y hay que decidir qué pasa con ella cuando se da de baja la cuenta.
* **Solapamiento con favoritos.** Una colección privada se parece a la lista de favoritos (`favorites`). Hay que explicar bien la diferencia en la interfaz y la ayuda.
* **Conflictos con PRs abiertos.** #463 y #483 añaden secciones al final de ADR-0008 y tocan `validation.ts`. Esta ADR se apoya en la regla de #463 (`canViewResource`, `isOthersPrivateDraft`), así que su implementación debe esperar a que #463 esté en `main`.
* **Renombrar `curator_id`** toca repositorio, seed, feeds, tests y frontend. Si se prefiere no tocarlo, se puede conservar el nombre de columna y llamarlo `ownerId` solo en el dominio, a costa de un nombre engañoso.

## Notas de Implementación

1. Esperar a que #463 esté en `main`.
2. Esquema y migración (`kind`, `visibility`, `owner_id`, `reviewed_by`, `reviewed_at`, `published_at`, `archived`, restricción única), con tests de migración en PGlite.
3. Reglas en `packages/db/src/validation.ts` (`canViewCollection`, `canManageCollection`, `canTransitionCollection`, `COLLECTION_TRANSITION_RULES`) con tests por rol: author, editor, curator propietario, curator ajeno y admin; colecciones editoriales, de autor públicas y privadas, en cada estado.
4. Repositorio y API: listados filtrados, `PATCH /:id/status`, filtro de `/:id/resources` (con el test de #463: un borrador ajeno en una colección no aparece para un curator) y API pública con `kind` y `ownerId`.
5. Recomendaciones: contar solo colecciones públicas publicadas.
6. Frontend: backoffice para author y editor, cola de revisión, etiqueta de tipo, bloques de portada, filtro y bloque en la ficha del autor.
7. Seed y ayuda (`help-content.ts`).

Plan detallado en `docs/epics/epic-003/features/feature-colecciones-de-autores/`.

### Preguntas abiertas

Cada una lleva la propuesta con la que se implementará si no se decide otra cosa:

1. **Recurso que se despublica estando en una colección pública.** Propuesta: desaparece de la vista pública y vuelve si se publica otra vez; el propietario ve «N recursos no disponibles». ¿Se avisa al propietario? ¿Y si la colección se queda sin ningún recurso publicado: sale del listado o solo de portada?
2. **Editar una colección de autor ya publicada.** Propuesta: sigue publicada sin nueva revisión, porque solo puede contener recursos publicados y el curator puede devolverla a borrador. ¿O un cambio de título o descripción debe volver a revisión?
3. **¿El curator ve las colecciones privadas?** Propuesta: no, solo el propietario y el admin, como dice la propuesta de #433 y en línea con #460.
4. **¿El curator ve las colecciones en borrador de otros (también las editoriales de otro curator)?** Propuesta: no, como los borradores de recursos (#460). Hoy sí las ve y las edita.
5. **Límites.** Propuesta: 100 recursos por colección (hoy es el límite de hecho de los listados) y, para author, un máximo de colecciones en revisión a la vez (por ejemplo, 5). ¿Hace falta un máximo de colecciones por autor?
6. **Denuncias de colecciones de autores.** Propuesta: ampliar `reports` para que admita una colección además de un recurso, en una issue aparte. ¿Es necesario antes de abrir las colecciones públicas de autores?
7. **Motivo al devolver a borrador.** ¿El curator debe escribir un motivo que vea el autor? Hoy la revisión de recursos tampoco lo pide; si se quiere, conviene decidirlo para los dos a la vez.
8. **Tipo de colección.** ¿Un curator o admin puede crear una colección de autor (una lista personal suya)? ¿Se puede convertir una colección de autor en editorial («promocionarla»)? Propuesta: no en esta fase.
9. **Baja de una cuenta.** Propuesta: sus colecciones de autor se borran; si alguna editorial es suya, pasa a otro curator o al admin antes de la baja.
10. **Orden del bloque de autores en portada.** Propuesta: las publicadas más recientes. ¿Se quiere que un curator pueda destacar algunas?
