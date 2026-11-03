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
Diccionario de equivalencias conocidas (LOM-ES/inglés → vocabulario informal ya usado en `procomun-ng`); sin match → slug del valor LOM crudo, marcado `mapped: false`. El vocabulario destino es `RESOURCE_TYPES` (`packages/db/src/resource-types.ts`, exportado como `@procomun/db/resource-types`) — única fuente de verdad, también usada por `apps/frontend/src/lib/resource-filters.ts` (filtro público) y validada contra `packages/db/src/seed-data.ts` (ver ADR-0029, actualización 2026-07-16 (3): antes cada uno mantenía su propia lista desincronizada).

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

## Ampliación — importador de usuarios legacy (2026-08-06)

### Flujo

```
usuarios.json
  └─ apps/cli/src/commands/import-legacy-users.ts
       ├─ packages/db/src/legacy-import/users.ts       (validación y mapeo puro)
       └─ packages/db/src/repository/legacy-users-import.ts
            └─ user                                   (sin fila en account)
```

### Mapeo

| Origen | Destino | Regla |
|---|---|---|
| `uid` | `user.id` | `legacy-procomun:user:<uid>`; estable para reejecuciones |
| `mail` | `user.email` | trim y minúsculas; obligatorio y con validación básica |
| `name` | `user.name` | trim; opcional |
| `roles` = `administrator` | `user.role` | `admin` |
| `roles` = `-` u otro | `user.role` | `author`; el valor no reconocido deja warning |
| `status` | `user.is_active` | activo solo para `1`, `"1"` o `true` |
| — | `user.email_verified` | `false`, para no asumir la vigencia del correo legacy |
| `pass` | — | no se importa |

`importLegacyUser()` comprueba primero el ID namespaced y después el email. La inserción usa `onConflictDoNothing()` y vuelve a consultar, de modo que una carrera entre dos procesos no crea duplicados ni sobrescribe cuentas existentes. Una colisión por email se informa como `skipped_existing_email`; nunca se fusionan automáticamente identidades.

### Actualización de política de rol (2026-08-06)

La tabla de mapeo anterior queda sustituida para `roles`: el importador ignora el valor Drupal y persiste siempre `user.role = "editor"`. No se eleva ningún `administrator` legacy a `admin`; los permisos administrativos se concederán mediante una revisión posterior explícita.

### Corrección de política de rol (2026-08-06)

La actualización anterior queda reemplazada por la decisión vigente: `roles = "administrator"` se persiste como `user.role = "admin"`; cualquier otro valor, incluido `-`, se persiste como `editor`. No hay otras elevaciones automáticas.

### Cierre de PGlite en CLI (2026-08-06)

Antes de salir, `import:legacy-users` cierra el cliente PGlite expuesto como `$client` por Drizzle, cuando el driver lo proporciona. Es necesario en ejecuciones CLI cortas: sin `close()`, el runtime WASM puede abortar durante la terminación del proceso. En PostgreSQL remoto no hay `$client.close()` compatible y el paso es un no-op seguro.

### Comando y rollback

`import:legacy-users --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]` escribe `informe_usuarios-<runId>.json` (o `informe_usuarios-dryrun-<runId>.json`). Cada registro importado incorpora el `userId` exacto; el rollback manual debe usar esa lista, comprobar que conserva el prefijo `legacy-procomun:user:` y no tiene asociaciones antes de eliminarlo. No se ofrece borrado automático en esta fase.

## Ampliación — categorización educativa al importar (2026-10-14)

Sustituye, para `learningContext[]`, la fila de la tabla de mapeo que decía que solo va a `resource_levels`.

- `learningContext[]` se sigue guardando tal cual en `resource_levels`: es el dato de origen y no se filtra por él.
- En la misma transacción del alta, `mapLegacyEducationalCategories()` (`packages/db/src/legacy-import/educational-category-map.ts`) traduce esas cadenas al catálogo de la issue #380 (ADR-0043) con las 31 reglas de la issue #383 y escribe `resource_educational_areas`.
- La comparación ignora mayúsculas, espacios sobrantes y guiones tipográficos. No hay coincidencias parciales. Una categoría sin regla no se asigna ni bloquea el recurso.
- El informe (`categorizacionEducativa`) cuenta, sobre recursos únicos, cuántos tienen todas sus categorías transformadas, cuántos quedan pendientes de revisión, cuántos no traen categorización y qué categorías no se reconocieron.

### Relleno de lo ya importado

Reimportar omite los recursos existentes (`skipped_existing`), así que lo importado antes de este cambio no tendría categorización. `import:legacy-procomun --backfill-categories [--dry-run] [--report-dir <ruta>]` no lee ficheros: aplica la misma correspondencia a `resource_levels` de los recursos con `import_source = 'legacy-procomun'`, no borrados y sin ninguna fila en `resource_educational_areas`.

- Es idempotente: un recurso ya clasificado, por la importación o a mano, no se toca, y repetir la pasada no cambia nada.
- `--dry-run` no escribe y devuelve las mismas cifras.
- Escribe `informe_relleno-categorias-<runId>.json` (o `informe_relleno-categorias-dryrun-<runId>.json`) con `totals.processed` y el mismo bloque `categorizacionEducativa`. Los recursos que solo tienen categorías sin regla, o ninguna, siguen sin clasificar y vuelven a aparecer en cada pasada.

Pendiente de decisión en #383: la correspondencia de los niveles A/B/C a ELE en recursos que no son de español.

## Actualización — Primaria por ciclos y ELE solo en español (2026-10-21)

Cierra lo pendiente de la sección anterior con lo que decidió Producto en #380, #383 y #394:

- Los cursos de Primaria van a los tres ciclos del catálogo (ADR-0043, adenda 2026-10-21): 1.º y 2.º al primer ciclo, 3.º y 4.º al segundo, y 5.º y 6.º al tercero.
- «Nivel básico (A)», «Nivel intermedio (B)» y «Nivel avanzado ( C )» solo se asignan a ELE si el idioma del recurso es `es`. En otro idioma no se asignan y el recurso cuenta como pendiente de revisión. El informe lo lista en `categorizacionEducativa.eleEnOtroIdioma` (y en el log como `ele_otro_idioma`). El relleno aplica la misma regla con el idioma guardado.

## Estado editorial desde `published` — 2026-10-22 (issue #447)

`mapLegacyRecord` calcula `editorialStatus` con `resolveLegacyPublicationStatus`: solo `published` igual a 1 se publica; 0, ausente o desconocido entra como `draft` (con warning si no es 0 ni 1). El informe guarda `editorialStatus` y `sourcePublished` por registro y `totals.importedAsDraft`.

Para lo importado antes, `import:legacy-procomun --fix-published --source-dir <ruta> [--dry-run]` relee los JSON y pasa a borrador los recursos publicados sin revisión editorial (sin `assignedCuratorId`, `curatedAt` ni `featuredAt`). Detalle en ADR-0029, actualización 2026-10-22.

## Roles de usuarios legacy: `editor` en lugar de `author` — 2026-11-03 (issue #507)

Sustituye, para `roles`, las filas de las tablas de mapeo anteriores y la tabla de la adenda de ADR-0037 del 2026-10-27 (#456).

| `roles` | `user.role` |
|---|---|
| `administrator`, `administrador` | `admin` |
| `publicador_certificado`, `-`, vacío o sin rol, `bm_documentalista`, `gestor_de_odes` | `editor` |
| Cualquier otro (`Organization`…) | `editor`, listado en `unknownRoles` |

Con varios roles separados por coma, `admin` gana a `editor`. Nunca `curator`. El mapeo está en `mapLegacyRoles()` (`packages/db/src/legacy-import/users.ts`). `LEGACY_DEFAULT_ROLE` es el rol de quien no trae rol o solo trae roles desconocidos.

### Corrección de lo ya importado (`--fix-roles`)

```
usuarios.json
  └─ import:legacy-users --fix-roles [--dry-run]   (runFixLegacyUserRoles)
       ├─ mapLegacyUser()                          (mapeo vigente del registro)
       └─ fixLegacyUserRole()                      (packages/db/src/repository/legacy-users-import.ts)
            └─ UPDATE user SET role = 'editor', updated_at = now()
               WHERE id = 'legacy-procomun:user:<uid>' AND role = 'author'
```

| Rol actual | Rol del mapeo | Resultado |
|---|---|---|
| `author` | `editor` | `fixed` (en dry-run, `would_fix`) |
| el del mapeo | — | `unchanged` (solo se cuenta) |
| `admin`, `curator`, `reader` u otro | — | `kept`, con el rol actual y el del mapeo |
| `author` | `admin` | `kept`: solo se corrige author → editor |
| sin cuenta con ese ID | — | `not_found` |

Detalle y límites en la adenda de ADR-0037 del 2026-11-03.

## Errores sin datos de la base de datos en informes y consola — 2026-11-03 (revisión del PR #488)

Hasta ahora, los importadores copiaban `error.message` en el informe y en `console.error`. Si el error venía de la base de datos, ese texto llevaba la consulta SQL y sus parámetros (Drizzle: `Failed query: … params: …`). Postgres además puede poner la fila rechazada en `detail` o el propio valor en su mensaje. Al importar usuarios, eso era el correo y el hash de la contraseña. Al importar recursos, los autores, que a veces llevan el correo. Así se incumplía lo que dice ADR-0037: «el hash nunca aparece en el informe ni en los avisos».

`apps/cli/src/import-errors.ts` resume cada error en un código controlado y nunca copia `message`, `detail`, `query` ni `params` de un error de la base de datos:

| `code` | Cuándo | Qué más lleva |
|---|---|---|
| `duplicate_email` | SQLSTATE 23505 en una restricción con `email` en el nombre | `sqlState`, `constraint` |
| `constraint_violation` | Cualquier otro SQLSTATE 23xxx | `sqlState`, `constraint` (solo si es un identificador) |
| `db_error` | Cualquier otro error de la base de datos | `sqlState`, si lo hay |
| `unexpected_error` | Un error que no es de la base de datos en un paso que solo la usa | La clase (`TypeError`…), nunca el mensaje |
| `invalid_record` | El registro de origen no es válido (mapeo o JSON ilegible) | El mensaje propio del importador |
| `import_error` | Fallo del procesado del `.elpx` o del almacenamiento (ZIP no válido, hash repetido) | El mensaje propio del importador |

El error se reconoce como de la base de datos si en algún punto de su cadena de causas (`cause`) lleva `query` y `params` (Drizzle) o un SQLSTATE con `severity` (pg, PGlite, postgres.js; en Bun.SQL el SQLSTATE está en `errno`). El nombre de la restricción sale de `constraint` o `constraint_name`.

En el informe, el registro de error queda así:

- `import:legacy-users` y `--fix-roles`: `{ outcome: "error", index, legacyUid, code, message, sqlState?, constraint? }`. El `legacyUid` permite reintentar el registro. Si falla el mapeo, el mensaje es el del mapeo (`mail ausente o inválido`). Si falla un paso posterior, que solo usa la base de datos, nunca se copia el mensaje.
- `import:legacy-procomun` y `--fix-published`: `{ outcome: "error", externalId, code, message, sqlState?, constraint? }`. Los mensajes propios del procesado se conservan porque sirven para diagnosticar y no salen de la base de datos. El aviso de `search_vector` solo lleva el resumen.

En consola: `[error] registro <n> (uid <uid>): <code> (<restricción>) [SQLSTATE <estado>]: <mensaje>`.

Los dos comandos pasan también por `withoutDbDetails()` los errores que salen de los bucles (por ejemplo, si falla `waitForDb`). Así el manejador general del CLI (`Error: <message>`) tampoco escribe la consulta.
