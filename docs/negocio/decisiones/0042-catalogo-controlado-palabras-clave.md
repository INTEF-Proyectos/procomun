# ADR-0042 Catálogo controlado de palabras clave

* Estado: Aceptado
* Fecha: 2026-10-14
* Agentes Implicados: [@.agents/skills/metadatos-y-curacion, @.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/ingestas-y-migraciones, @.agents/skills/frontend-ux-accesibilidad]

## Contexto y Problema

El campo «Palabras clave» de los recursos aceptaba texto libre. Eso mezcla denominaciones equivalentes, impide un autocompletado fiable y, si la importación volcara todas las etiquetas antiguas, llenaría el catálogo de términos de un solo uso. La issue #384 fija un catálogo de 50 términos, un máximo de 5 por recurso y una tabla de correspondencias para las etiquetas que sí se reconocen.

ADR-0034 ya guarda etiquetas libres en `tags` y `resource_tags`, con `canonical_tag_id` para sinónimos. Un vocabulario paralelo duplicaría asociaciones, filtros y la ficha.

## Opciones Consideradas

* Tabla nueva de palabras clave, independiente de `tags`.
* Seguir creando una etiqueta por cada texto libre y limitar solo la interfaz.
* Extender `tags` con una marca de catálogo, alias propios y el autor del alta.

## Decisión

Se extiende el modelo de ADR-0034. Una fila con `catalog = true` es una palabra clave controlada; el resto sigue siendo etiqueta libre y no se ofrece en el autocompletado. Los alias viven en `tag_aliases` (un mismo alias, como ABP, puede apuntar a dos términos). El recurso guarda el id del catálogo en `resource_tags`. Quien crea un término queda en `created_by` junto con `created_at`.

La búsqueda normaliza mayúsculas, tildes y espacios, y ordena la coincidencia de etiqueta por delante del alias. El alta desde el campo exige confirmación, comprueba duplicados normalizados y no está abierta a author, editor ni reader. La importación aplica solo la tabla de correspondencias de la issue: lo que no encaja, o lo que superaría cinco términos, queda en `keyword_import_reviews` y no genera palabras clave nuevas. El texto original permanece en `resources.keywords`.

## Consecuencias

### Positivas
* Un solo grafo de etiquetas para filtro, ficha y reutilización.
* El catálogo inicial tiene ids estables, derivados de la denominación.
* Repetir la importación no duplica asociaciones ni revisiones.

### Negativas / Riesgos
* Quedan fuera de esta entrega la pantalla de gestión, el renombrado, la edición de alias ya creados, la fusión, la desactivación y el cierre de revisiones en interfaz.
* Las etiquetas libres de ADR-0034 siguen creándose desde el texto de origen. No se promocionan solas a catálogo.

## Notas de Implementación

Migración `0009_keyword_catalog`. El sembrado de los 50 términos corre al arrancar la API (`import.meta.main`), no en los tests que comparten PGlite. El campo de alta y edición busca y selecciona; el alta al catálogo sale de ese campo con confirmación (`POST /api/admin/keywords`).

## Actualización 2026-10-14 — revisión del PR #397

Sustituye a lo anterior donde lo contradiga. La correspondencia de etiquetas antiguas (apartado 5 de #384) sale de esta entrega y va en un PR apilado.

### Sembrado

* Los 50 términos y sus alias se insertan por SQL: en la migración `0010_keyword_catalog` y, con el mismo bloque (`KEYWORD_CATALOG_SEED`), en `setup.ts`, que es el esquema de PGlite y del arranque con Docker. Un test comprueba que los dos coinciden.
* El bloque solo inserta si no hay ningún término de catálogo. No modifica etiquetas existentes ni recupera términos o alias borrados. La API ya no siembra nada al arrancar.

### Slugs y enlaces

* Los términos sembrados tienen un id estable igual al slug de su denominación (`geometria`).
* Si una etiqueta libre ya usa ese slug, el término recibe `<slug>-catalogo` y la etiqueta libre se queda como estaba. Las altas posteriores usan el sufijo numérico de `allocateUniqueSlug`.
* `?tag=` y `/tags/:slug` siguen siendo por slug, como en ADR-0034. El filtro resuelve el slug a la etiqueta y filtra por su id. No se acepta un id en `?tag=`, porque el id de un término puede coincidir con el slug de una etiqueta libre.

### Convivencia con ADR-0034

* La vía antigua (`keywords` por la API con token, restaurar versión, «Migrar keywords» y `PUT /api/admin/tags/resources/:id`) solo gestiona etiquetas libres. No asigna ni quita términos de catálogo: si un texto coincide con un término, no se enlaza. La asignación por identidad corresponde a la correspondencia, que respeta el máximo.
* `setResourceTagsByLabels` deja de reescribir `resources.keywords`. Ese campo es el texto de origen.
* `assertCatalogKeywordIds` valida en el servidor el máximo de 5, los duplicados y que cada id sea del catálogo. Pasan por ella el alta y la edición. `mergeTags` rechaza fusionar una etiqueta libre con un término, porque movería enlaces y podría superar el máximo.
* `keywordIds` va en el mismo `POST` o `PATCH` del recurso y se valida antes de escribir. Una selección inválida devuelve 400 y no deja un recurso creado. Desaparecen `GET` y `PUT /api/admin/resources/:id/keywords`.

### Proyección a búsqueda, feeds, API y recomendaciones

* No se copia nada en `resources.keywords`. Donde ya se lee `keywords` se leen también las denominaciones de catálogo, con una única subconsulta (`catalogLabelsSql`): el vector FTS (peso B), las recomendaciones (palabras compartidas y consulta de la semilla) y el listado (`catalogLabels`, que usan los feeds). La API v1 y la ficha reciben `catalogKeywords` de `getResourceById` y `getResourceBySlug`.
* Es la forma mínima que no duplica datos, no deja copias desfasadas al fusionar o renombrar y no toca el texto de origen. Cuesta una subconsulta por fila sobre la clave primaria de `resource_tags`.
* La búsqueda simple del listado (`LIKE` sobre `keywords`) no incluye aún las denominaciones de catálogo.

### Fondo actual

* La ficha muestra los términos de catálogo y, si el recurso no tiene ninguno, el texto de `keywords` como hasta ahora.
* El filtro del buscador usa el campo del catálogo. Con `tags=1` añade las etiquetas libres que coinciden, marcadas como «etiqueta», para que el fondo sin catálogo siga siendo filtrable.

### Otros cambios

* `/api/admin/keywords` queda detrás de `requireRole("curator")`, como el resto de secciones de `admin/index.ts`.
* Índice único `tags_catalog_label_unique` sobre la denominación en minúsculas y sin tildes de los términos de catálogo, para dos altas simultáneas.
* Se retiran `keyword_import_reviews`, `canManageKeywordCatalog` (se usa `hasMinRole`), el paso previo `confirm=false`, `acknowledgeAliases`, el caso `maxSelections === 1`, el manejo propio del pegado y `KeywordCatalogError`.
* La migración pasa a `0010_keyword_catalog` (idx 8, `when` 1786650000000) para ir detrás de `0009_educational_areas` (#394).

### Riesgos abiertos

* Hasta que se aplique la correspondencia, el fondo importado no tiene términos de catálogo. Sigue localizable por texto, ficha y filtro de etiquetas.
* Falta la gestión del catálogo (fusionar, desactivar, editar alias) antes de abrir el alta masiva. Si alguna vez se desactivaran todos los términos con `catalog = false`, el sembrado volvería a ejecutarse.
* Producto debe decidir la relación entre los términos que son materias y el campo «Materias».
* Las versiones del recurso no guardan los términos de catálogo; restaurar una versión conserva los actuales.

## Actualización 2026-10-14 — correspondencia de etiquetas antiguas

Cubre el apartado 5 de #384, en el PR apilado sobre #397.

* El comando `import:legacy-keywords [--dry-run] [--report-dir <ruta>]` cruza el texto de origen (`resources.keywords`) con el catálogo. Lo parte por la coma con la que el importador unió las etiquetas (`buildKeywords`): una etiqueta de origen que ya tuviera coma llegó partida y no se puede recuperar aquí.
* Correspondencia: una etiqueta igual, normalizada, a una denominación se asigna a ese término. Si no, se usan los alias, que son la tabla de correspondencias de la issue sembrada en `tag_aliases`. Un alias de varios términos (ABP) se trata como ambiguo y no se asigna.
* Máximo: si los términos que ya tiene el recurso más los nuevos superan 5, no se asigna nada y el caso va al informe con lo actual y lo propuesto.
* Rendimiento: catálogo, alias, recursos y enlaces se leen una vez; no hay consultas por recurso al catálogo. Los enlaces nuevos se insertan por lotes y se reindexa FTS solo en los recursos que cambian.
* Es idempotente: solo añade los ids que faltan. No crea términos ni modifica `keywords`.
* Informe JSON con totales (recursos, con correspondencia, cobertura, asignados, ya asignados, más de 5), etiquetas sin correspondencia y ambiguas con el número de recursos, casos de más de 5 y lo asignado. Los casos a revisar quedan en el informe y no en una tabla: no hay todavía interfaz para resolverlos, y repetir el comando tras ajustar alias o selecciones los recalcula.

## Actualización 2026-10-22 — renumeración de la migración

* `main` incorporó `0010_resource_thumbnail_url` (#425) con idx 8. La migración del catálogo pasa a `0011_keyword_catalog` (idx 9, `when` 1792130000000), para ir detrás de ella. El contenido no cambia.

## Actualización 2026-10-26 — términos retirados por las áreas de conocimiento

* Los términos que pasan a ser áreas de conocimiento (#448, ADR-0045) se retiran con `tags.retired_at`: no salen en la búsqueda del catálogo ni se pueden añadir a un recurso, y los recursos que ya los tienen los conservan al volver a guardar.
* Un término retirado sigue ocupando su denominación: dar de alta otro igual devuelve el existente como duplicado.
* La retirada se hace con `catalog:area-keywords`, en seco por defecto.
