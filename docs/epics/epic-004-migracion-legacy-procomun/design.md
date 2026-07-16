# Design — Épica 004: importador de recursos legacy Procomún (.elpx)

Ver ADR-0029 para la decisión arquitectónica formal. Este documento detalla el diseño técnico.

## Arquitectura

```
<source-dir>/*.json + *.elpx
        │
        ▼
apps/cli/src/commands/import-legacy-procomun.ts   (orquestador CLI)
        │
        ├─▶ packages/db/src/legacy-import/field-mapper.ts   (mapeo + normalización, puro)
        │       ├─ normalize-license.ts
        │       ├─ normalize-language.ts
        │       └─ resource-type-map.ts
        │
        ├─▶ apps/api/src/services/elpx-processor.ts          (REUTILIZADO, no modificado salvo fix de bug)
        │       └─ elpx-safe-extract.ts                       (REUTILIZADO, ADR-0026a)
        │
        └─▶ packages/db/src/repository/legacy-import.ts       (persistencia transaccional)
                └─ resources / resource_subjects / resource_levels / elpx_projects / media_items / upload_sessions
```

## Mapeo de campos (JSON legacy → `resources`/`elpx_projects`)

| Origen | Destino | Transformación |
|---|---|---|
| `idODE` (fallback `id`) | `resources.externalId` | `firstNonEmpty()` — trata cadenas vacías igual que `null`/`undefined`; unicidad garantizada junto con `importSource` |
| — (constante) | `resources.importSource` | `"legacy-procomun"` |
| `rutaAccesoContenidos` (fallback `technicalLocationStr`) | `resources.sourceUri` | `firstNonEmpty()` |
| `titleStr` | `resources.title` | `trim()`, trunca a 500 |
| `descriptionStr` (fallback `educationalDescriptionStr[0]`) | `resources.description` | `trim()`, trunca a 5000; vacío en ambas → **bloqueante** |
| `generalLanguageStr[0]` (fallback `educationalLanguageStr[0]`) | `resources.language` | `normalizeLanguage()`; si no reconocido → fallback `"es"` marcado `guessed: true` (tolerable) |
| `rightsCopyrightAndOtherRestrictionsStr` | `resources.license` | `normalizeLicense()`; si no matchea → **bloqueante**; excepción: combinación `no derivs` + `share alike` (imposible en CC real) → se resuelve a `*-sa` con warning, no bloqueante — ver sección `normalizeLicense()` más abajo |
| `resourceType[0]` (fallback `educationalLearningResourceTypeStr[0]`) | `resources.resourceType` | `mapResourceType()`; diccionario + slug de fallback; trunca a 100 (`varchar(100)`), warning si se trunca |
| `knowledgeArea[]` | `resource_subjects` | una fila por valor no vacío, `trim()`, trunca a 255 (`varchar(255)`), warning agregado si se trunca alguna |
| `learningContext[]` | `resource_levels` | una fila por valor no vacío, `trim()`, trunca a 100 (`varchar(100)`), warning agregado si se trunca alguna |
| `authorStr[0]` (fallback `publicatorNameStr`) | `resources.author` | primer valor no vacío tras `trim()`, trunca a 500 |
| `publicatorNameStr` | `resources.publisher` | `trim()`, opcional |
| `labelsStr[]` (filtrando vacíos) | `resources.keywords` | join por comas respetando el límite de 1000 caracteres (añade palabras clave completas mientras quepan, no corta una a la mitad), warning si se omite alguna |
| `publicationDate` (fallback `fechaRegistro` parseado `YYYYMMDD`) | `resources.importedAt` **y** `resources.createdAt` | fecha de origen, no instante de ejecución del importador — usada también como `createdAt` para que el catálogo público (`listResources()`, `ORDER BY createdAt DESC`) conserve la cronología histórica real; ver Actualización 2026-07-10 en ADR-0029 |
| — | `resources.editorialStatus` | `"published"` fijo — decisión revisada el 2026-07-10, ver Actualización en ADR-0029 (originalmente se importaba como `"draft"`) |
| — | `resources.createdBy` | `null` |
| `.elpx` | `elpx_projects` + `media_items` + `upload_sessions` | vía `processElpxUpload()` reutilizado con `{ hash: uploadId }` (ruta de extracción privada por intento, no el checksum — ver "Rutas de extracción únicas por intento" más abajo); `elpx_projects.hash` guarda el checksum SHA-256 real y `elpx_projects.extractPath` la ruta final `storageDir/elpx/<checksum>`, aunque la promoción física a esa ruta ocurra como paso posterior al `INSERT` |

### `normalizeLicense()`
1. Normaliza a minúsculas, sin acentos, espacios colapsados.
2. Si no contiene `"creative commons"` / no empieza por `"cc"` / no es `"cc0"` → no matchea, **bloqueante**.
3. Detecta tokens: `attribution` (base `cc-by`), `non commercial` → `-nc`, `share alike` → `-sa`, `no derivs` → `-nd`.
4. **`no derivs` + `share alike` a la vez**: combinación imposible en las licencias CC reales (`ND` prohíbe obras derivadas, `SA` exige liberar las derivadas con la misma licencia — mutuamente excluyentes por diseño de Creative Commons, no una laguna de `VALID_LICENSES`). Se interpreta como error de captura del formulario de origen y se **resuelve priorizando `SA` sobre `ND`** (se descarta `ND`), no bloqueante — decisión de negocio confirmada tras la revisión del PR #268 (ver ADR-0029, actualización 2026-07-16). Se registra un warning tolerable (`field: "license"`) en el informe, no un bloqueo.
5. Mapea a `VALID_LICENSES` (`packages/db/src/validation.ts`); cualquier otra combinación fuera de esas 6 variantes → bloqueante, se registra el string crudo agrupado por frecuencia en el informe.
6. Sufijo de versión (`4.0`, `3.0`) se ignora.

### `normalizeLanguage()`
Normaliza código ISO 639, valida contra `VALID_LANGUAGES`; si falla, fallback `"es"` con `guessed: true`.

### `mapResourceType()`
Diccionario de equivalencias conocidas (LOM-ES → vocabulario informal ya usado en `procomun-ng`, ver `packages/db/src/seed-data.ts`); sin match → slug del valor LOM crudo, marcado `mapped: false`.

## Idempotencia y deduplicación

- Índice único parcial en BD: `resources_import_source_external_id_idx` sobre `(import_source, external_id) WHERE external_id IS NOT NULL` (ver migración `packages/db/migrations/0004_resources_import_dedup_index.sql` y `packages/db/src/setup.ts`).
- Comprobación previa (`findLegacyResourceByExternalId`) antes de insertar → registros ya existentes se cuentan como `skipped`, no como error.
- Deduplicación secundaria por contenido: `elpx_projects.hash` guarda el checksum SHA-256 real del `.elpx` (no un UUID aleatorio ni el `uploadId`), y esa columna tiene restricción `UNIQUE` en BD — es esa restricción, atómica por diseño del motor de base de datos, la que garantiza que dos `idODE` distintos nunca puedan compartir el mismo contenido persistido, incluso bajo ejecuciones concurrentes (ver "Rutas de extracción únicas por intento" más abajo).
- Antes de extraer, se comprueba `getElpxProjectByHash()` como optimización (evita gastar trabajo de extracción en el caso común, secuencial, de contenido ya conocido); si el hash ya existe, el registro se reporta como `error` sin extraer. Esta comprobación **no** es la garantía de corrección — ver más abajo.
- Si la persistencia falla por cualquier motivo tras una extracción exitosa, el `extractPath` en disco se limpia con `removeElpxExtraction()` de forma incondicional y siempre segura (ver "Rutas de extracción únicas por intento").
- Transacción Drizzle **por registro** (no por lote de 500): cada recurso toca 6 tablas y tiene efectos de sistema de ficheros (extracción del `.elpx`); un fallo aislado no debe invalidar los registros ya confirmados del lote.
- La lectura y el mapeo de cada `.json` están envueltos en su propio `try/catch` (`iterateResolvedPairs()` para el parseo, y el bloque de mapeo para `mapLegacyRecord()`): un `.json` corrupto o con forma inesperada se reporta como `error` para ese registro y no aborta el resto del lote.

## Errores bloqueantes vs. tolerables

**Bloqueantes** (se salta el registro, se cuenta en el informe, no aborta el lote):
- `description` vacía en ambas fuentes.
- `license` no normalizable.
- `.elpx` corrupto o que falla `validateElpxFile`/`safeExtractElpx`.
- JSON sin `.elpx` pareja o viceversa.

**Tolerables** (se importa con warning):
- `language` no reconocible → fallback `"es"`.
- `resourceType` sin mapeo explícito → slug derivado.
- Campos que exceden longitud máxima → truncados.
- Listas de materias/niveles/etiquetas vacías → sin filas relacionadas.

## Rollback

Sin transacción atómica global (deliberado). Cada ejecución se marca con un `runId` y escribe su informe en `informe_ingesta-<runId>.json` (o `informe_ingesta-dryrun-<runId>.json` en `--dry-run`, que no requiere rollback al no escribir nada).

**Identificación de los recursos de una ejecución**: el rollback **no debe** filtrar por rango de `createdAt` — ese campo contiene ahora la fecha de publicación original de cada recurso (ver Actualización 2026-07-10 de ADR-0029), no el instante de la importación, así que no identifica qué recursos pertenecen a qué ejecución. La fuente de verdad es el propio informe: cada registro con `outcome: "imported"` incluye su `resourceId` exacto. El procedimiento de rollback es:

1. Leer `informe_ingesta-<runId>.json` y extraer los `resourceId` de todos los registros con `outcome: "imported"`.
2. Por cada `resourceId`: `deleteResource()` (soft delete ya existente, cascada a `resource_subjects`/`resource_levels`/`media_items`/`elpx_projects`/`upload_sessions`), más limpieza física de `extractPath` en disco con `removeElpxExtraction()` (el `CASCADE` de BD no borra ficheros extraídos) — solo si ningún otro `elpx_project` referencia el mismo `hash` (`getElpxProjectByHash()`, mismo criterio que usa el propio importador para no romper una deduplicación legítima).

Si el informe de una ejecución se ha perdido, como alternativa menos precisa se puede acotar por `upload_sessions.createdAt` (ese campo sí conserva el instante real de la importación, sin verse afectado por el cambio de semántica de `resources.createdAt`) unido a `resources` por `resource_id`, filtrando además por `resources.import_source = 'legacy-procomun'` y el rango de tiempo aproximado de la ejecución — pero es un mecanismo de último recurso, no el procedimiento recomendado.

**Directorios en `storageDir/elpx/<checksum>` sin ningún `elpx_project` que los referencie no son necesariamente basura a limpiar manualmente**: desde ADR-0029 (actualización 2026-07-16), el propio importador los reclama automáticamente en su siguiente intento de importar ese mismo contenido (ver "Rutas de extracción únicas por intento, promocionadas tras el commit" más arriba). Solo hace falta limpieza manual si no se espera ninguna reimportación futura de ese contenido concreto.

## Comando CLI

`apps/cli/src/commands/import-legacy-procomun.ts`, registrado en `apps/cli/src/index.ts` como `import:legacy-procomun`.

Flags: `--source-dir <path>`, `--dry-run`, `--limit <n>`, `--only <externalId>`, `--report-dir <path>` (por defecto `local-data/legacy-import-reports/`, ya gitignored).

Sigue los patrones ya existentes en `apps/cli/src/commands/`: progreso incremental (patrón `fts-reindex.ts`), skip silencioso con log por registro (patrón `seed-resources.ts`).

`--only <externalId>` filtra por el `externalId` real resuelto del contenido del `.json` (`iterateResolvedPairs()` lee y parsea cada `.json` para resolverlo), no por el nombre de fichero — el nombre exportado solo coincide con `idODE` en la muestra observada, no es un identificador fiable en general.

### Lectura en streaming, no precomputada

`iterateResolvedPairs()` es un generador async (`AsyncGenerator`), no una función que devuelve un array precomputado: el bucle principal lo consume con `for await...of` y corta (`break`) en cuanto `--only` encuentra su objetivo o `--limit` alcanza su cupo. Por la semántica de los generadores de JavaScript, el resto de ficheros del directorio nunca se leen ni parsean — necesario porque el volumen real documentado (~78.800 recursos, ver ADR-0029) haría que materializar todos los JSON en memoria antes de filtrar agotara memoria innecesariamente, y que `--limit 1` leyera igualmente el lote completo antes de recortar.

### Rutas de extracción únicas por intento, promocionadas tras el commit

Comprobar `getElpxProjectByHash()` antes de extraer (como hacía una iteración anterior de este diseño) reduce la ventana del problema pero no lo elimina: la comprobación no es atómica con la extracción ni con la inserción posterior (TOCTOU). Bajo concurrencia real (dos ejecuciones del CLI corriendo a la vez, o dos llamadas paralelas), ambas podrían pasar la comprobación antes de que cualquiera persista.

Por eso la ruta física de extracción se desacopla del valor de deduplicación durante la extracción: `processElpxUpload(storagePath, config.storageDir, { hash: uploadId })` construye la ruta como `storageDir/elpx/<uploadId>` — el `uploadId` es un `crypto.randomUUID()` generado de nuevo en cada intento, así que dos intentos **nunca** comparten ruta física durante la extracción, tengan o no el mismo contenido.

**La ruta física final, sin embargo, es `storageDir/elpx/<checksum>`** (ver fila `.elpx` en la tabla de mapeo, más arriba), porque es la ruta que reconstruye la URL pública de la preview (`buildElpxPreview()` en `apps/api/src/elpx/preview.ts`, resuelta por `apps/api/src/routes/elpx-content.ts`) a partir de `elpx.hash` — igual que en el resto de flujos de subida (`uploads.ts`, `admin/elpx.ts`), donde el directorio físico y `elpx.hash` son siempre el mismo valor. El orden de las operaciones importa aquí, y quedó fijado tras dos iteraciones (ver ADR-0029, actualización 2026-07-16):

1. **Primero, la inserción en BD** (`importLegacyResourceWithElpx`), con `elpx.hash = checksum` y `elpx.extractPath` ya fijado a la ruta final `storageDir/elpx/<checksum>` — aunque el directorio físico siga todavía en su ruta privada por `uploadId`. Es la restricción `UNIQUE` de `elpx_projects.hash`, atómica por diseño del motor de base de datos, la que decide de forma recuperable quién es el dueño legítimo de un checksum, no una operación de filesystem.
2. **Después, la promoción física** (`promoteElpxExtractionPath()`): `rename(storagePath_privado, storagePath_final)`. Como la fila en BD ya confirmó que somos los únicos dueños de este checksum, cualquier directorio ya presente en la ruta final solo puede ser basura huérfana de una ejecución anterior interrumpida entre su propio commit y su propio `rename()` — nunca de un competidor legítimo. Si el `rename()` falla con `ENOTEMPTY`/`EEXIST`, se reclama (se borra el huérfano) y se reintenta una vez.

Este orden es deliberado y no es intercambiable: promocionar el directorio **antes** de confirmar en BD (la primera iteración de este fix) dejaba un directorio huérfano sin fila asociada si el proceso se interrumpía justo entre ambos pasos, bloqueando permanentemente cualquier reimportación futura de ese contenido — exactamente el modo de fallo que este orden evita.

Consecuencia práctica: la limpieza de `extractPath` en el `catch` (que solo se alcanza si la inserción en BD **no** llegó a confirmar) es **siempre segura de forma incondicional** sobre la ruta privada por `uploadId` — como esa ruta es exclusiva de su propio intento, jamás puede coincidir con la de otro intento, gane o pierda una carrera. Cualquier fallo **después** de que la inserción confirme (incluida la propia promoción) se trata como best-effort (warning), nunca como error del registro — ver "Indexación para búsqueda" más abajo, mismo patrón. `getElpxProjectByHash()` antes de extraer se conserva como optimización para el caso común (evita trabajo de extracción para contenido ya conocido cuando no hay concurrencia), pero la corrección ya no depende de ella.

## Indexación para búsqueda (FTS)

Tras persistir cada recurso con éxito, el comando llama a `updateSearchVector(db, resourceId)` (`apps/api/src/fts/search.ts`, mismo helper que usa la creación manual de recursos en `apps/admin/resources.ts`) para que quede indexado en `resources.search_vector` de inmediato, sin depender de una ejecución manual posterior de `fts:reindex`. Es una llamada *best-effort*: si falla, el recurso ya persistido y `published` no se marca como `error` (perdería la idempotencia y quedaría bloqueado en reintentos posteriores, ya que `findLegacyResourceByExternalId` lo detectaría como existente), sino que se añade un warning tolerable al registro (`imported` con warning) indicando que hay que correr `fts:reindex` manualmente para ese recurso.

## Fixtures de test

`ode-export/` no está versionado. Se copian fixtures reducidas y versionadas:
- `packages/db/src/test-fixtures/legacy-procomun/*.json` — 3-4 ejemplos cubriendo ambas generaciones (nativos MEC `es_...` y legacy Agrega numéricos).
- `apps/api/src/test-fixtures/elpx/*.elpx` — 2-3 `.elpx` pequeños del mismo origen, añadidos al directorio ya existente.
