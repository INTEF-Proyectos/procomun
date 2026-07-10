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
| `idODE` (fallback `id`) | `resources.externalId` | tal cual; unicidad garantizada junto con `importSource` |
| — (constante) | `resources.importSource` | `"legacy-procomun"` |
| `rutaAccesoContenidos` (fallback `technicalLocationStr`) | `resources.sourceUri` | tal cual |
| `titleStr` | `resources.title` | `trim()`, trunca a 500 |
| `descriptionStr` (fallback `educationalDescriptionStr[0]`) | `resources.description` | `trim()`, trunca a 5000; vacío en ambas → **bloqueante** |
| `generalLanguageStr[0]` (fallback `educationalLanguageStr[0]`) | `resources.language` | `normalizeLanguage()`; si no reconocido → fallback `"es"` marcado `guessed: true` (tolerable) |
| `rightsCopyrightAndOtherRestrictionsStr` | `resources.license` | `normalizeLicense()`; si no matchea → **bloqueante** |
| `resourceType[0]` (fallback `educationalLearningResourceTypeStr[0]`) | `resources.resourceType` | `mapResourceType()`; diccionario + slug de fallback (tolerable) |
| `knowledgeArea[]` | `resource_subjects` | una fila por valor no vacío, `trim()` |
| `learningContext[]` | `resource_levels` | una fila por valor no vacío, `trim()` |
| `authorStr[0]` (fallback `publicatorNameStr`) | `resources.author` | primer valor no vacío tras `trim()`, trunca a 500 |
| `publicatorNameStr` | `resources.publisher` | `trim()`, opcional |
| `labelsStr[]` (filtrando vacíos) | `resources.keywords` | `join(",")` deduplicado |
| `publicationDate` (fallback `fechaRegistro` parseado `YYYYMMDD`) | `resources.importedAt` | fecha de origen, no instante de ejecución del importador |
| — | `resources.editorialStatus` | `"draft"` fijo |
| — | `resources.createdBy` | `null` |
| `.elpx` | `elpx_projects` + `media_items` + `upload_sessions` | vía `processElpxUpload()` reutilizado, mismo patrón que `POST /api/admin/elpx/upload/:resourceId` |

### `normalizeLicense()`
1. Normaliza a minúsculas, sin acentos, espacios colapsados.
2. Si no contiene `"creative commons"` / no empieza por `"cc"` / no es `"cc0"` → no matchea, **bloqueante**.
3. Detecta tokens: `attribution` (base `cc-by`), `non commercial` → `-nc`, `share alike` → `-sa`, `no derivs` → `-nd`.
4. Mapea a `VALID_LICENSES` (`packages/db/src/validation.ts`); combinación inválida → bloqueante, se registra el string crudo agrupado por frecuencia en el informe.
5. Sufijo de versión (`4.0`, `3.0`) se ignora.

### `normalizeLanguage()`
Normaliza código ISO 639, valida contra `VALID_LANGUAGES`; si falla, fallback `"es"` con `guessed: true`.

### `mapResourceType()`
Diccionario de equivalencias conocidas (LOM-ES → vocabulario informal ya usado en `procomun-ng`, ver `packages/db/src/seed-data.ts`); sin match → slug del valor LOM crudo, marcado `mapped: false`.

## Idempotencia y deduplicación

- Índice único parcial en BD: `resources_import_source_external_id_idx` sobre `(import_source, external_id) WHERE external_id IS NOT NULL` (ver migración `packages/db/migrations/0004_resources_import_dedup_index.sql` y `packages/db/src/setup.ts`).
- Comprobación previa (`findLegacyResourceByExternalId`) antes de insertar → registros ya existentes se cuentan como `skipped`, no como error.
- Deduplicación secundaria por contenido: `elpx_projects.hash` ya es único; un `.elpx` idéntico bajo dos `idODE` distintos se detecta como "duplicado de contenido".
- Transacción Drizzle **por registro** (no por lote de 500): cada recurso toca 6 tablas y tiene efectos de sistema de ficheros (extracción del `.elpx`); un fallo aislado no debe invalidar los registros ya confirmados del lote.

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

Sin transacción atómica global (deliberado). Cada ejecución se marca con un `runId`. Rollback de una ejecución completa: `deleteResource()` (soft delete ya existente, cascada a tablas relacionadas) filtrando por `importSource` + rango de `createdAt`, más limpieza física de `extractPath` en disco con `removeElpxExtraction()` (el `CASCADE` de BD no borra ficheros extraídos).

## Comando CLI

`apps/cli/src/commands/import-legacy-procomun.ts`, registrado en `apps/cli/src/index.ts` como `import:legacy-procomun`.

Flags: `--source-dir <path>`, `--dry-run`, `--limit <n>`, `--only <externalId>`, `--report-dir <path>` (por defecto `local-data/legacy-import-reports/`, ya gitignored).

Sigue los patrones ya existentes en `apps/cli/src/commands/`: progreso incremental (patrón `fts-reindex.ts`), skip silencioso con log por registro (patrón `seed-resources.ts`).

## Fixtures de test

`ode-export/` no está versionado. Se copian fixtures reducidas y versionadas:
- `packages/db/src/test-fixtures/legacy-procomun/*.json` — 3-4 ejemplos cubriendo ambas generaciones (nativos MEC `es_...` y legacy Agrega numéricos).
- `apps/api/src/test-fixtures/elpx/*.elpx` — 2-3 `.elpx` pequeños del mismo origen, añadidos al directorio ya existente.
