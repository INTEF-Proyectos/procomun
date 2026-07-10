# Validation — Épica 004: importador de recursos legacy Procomún (.elpx)

## Validación automatizada prevista

- `bun test packages/db/src/legacy-import/*.unit.test.ts`
- `bun test packages/db/src/repository.unit.test.ts`
- `bun test apps/cli/src/commands/import-legacy-procomun.unit.test.ts apps/cli/src/commands/import-legacy-procomun.integration.test.ts`
- `bun test apps/api/src/services/elpx-fixtures.unit.test.ts` (regresión del fix `pp_license`/`pp_lang`)
- `bun run scripts/check-test-files.ts`

## Resultado esperado (piloto Fase 1)

- 9/9 pares de `ode-export/` procesables sin error bloqueante (o, si alguno falla, causa documentada y clasificada).
- Reejecución del comando sobre el mismo directorio: 0 duplicados, 9 `skipped`.
- `--dry-run` no escribe en base de datos.
- Recursos importados editables y visibles en el backoffice admin, con preview `.elpx` funcional.
- `language`/`license` correctamente pobladas en los recursos importados (verifica el fix de ADR-0029).

## Fase 0 — resultado (2026-07-10)

- `bun test apps/api/src/services/elpx-fixtures.unit.test.ts` ✅ (`26 pass`, `0 fail`) — confirma que los 8 fixtures reales de `.elpx` ahora extraen `language` y `license` tras el fix de `METADATA_KEYS`.
- `bun test packages/db/src/repository.unit.test.ts packages/db/src/search.test.ts` ✅ (`18 pass`, `0 fail`) — confirma que el nuevo índice único parcial `resources_import_source_external_id_idx` no rompe flujos existentes (seed, búsqueda).

## Fase 1 — resultado (2026-07-10)

### Tests automatizados
- `bun test packages/db/src/legacy-import/` → 30/30 pass.
- `bun test packages/db/src/repository.unit.test.ts` → 18/18 pass (incluye 5 tests nuevos de `legacy-import`).
- `bun test apps/cli/` → 22/22 pass (incluye 8 unit + 4 integración de `import-legacy-procomun`).
- `bun test apps/ packages/ scripts/` (monorepo completo) → **783/783 pass, 0 fail**.
- `bun run scripts/check-test-files.ts` → "All tracked TypeScript source files have an accepted test file."

### Piloto sobre los 9 ejemplos reales de `ode-export/`

**Dry-run** (`import:legacy-procomun --source-dir ode-export --dry-run`):
```
9 pares encontrados, procesando 9...
importados=8 omitidos_ya_existentes=0 bloqueados=1 errores=0 incompletos=0
```

**Ejecución real** (entorno PGlite/storage temporal aislado en `/tmp`, con autorización explícita del usuario; eliminado por completo tras la verificación — nunca se escribió en `local-data/` del repo ni se comprometió nada a git):
```
importados=8 omitidos_ya_existentes=0 bloqueados=1 errores=0 incompletos=0
```
Coincide exactamente con la predicción del dry-run (idempotencia de la comprobación previa confirmada).

Verificación directa en BD de los 8 recursos importados: `title`, `language`, `license`, `resourceType`, `externalId`, `importSource` correctos; `elpx_projects.hasPreview = true` en los 8; `media_items.filename`/`fileSize` coinciden con el `.elpx` de origen. 3 de los 8 recibieron warning tolerable de `resourceType` sin equivalencia en el diccionario (slugs `mapa-conceptual`, `leccion-magistral`, `cuestionario` — candidatos a ampliar el diccionario de `resource-type-map.ts` en una iteración futura). El único bloqueado (`es_2025101012_9102834`) lo fue por la combinación de licencia CC inexistente `"attribution - non derived work - non commercial - share alike"`, exactamente el caso que motivó la regla de rechazo ND+SA en `normalizeLicense()`.

### Regresión del fix de metadatos (ADR-0029)
`bun test apps/api/src/services/elpx-fixtures.unit.test.ts` → 26/26 pass, confirmando que los 8 fixtures reales de `.elpx` ya existentes extraen `language`/`license` tras el fix de `pp_license`/`pp_lang`.

### Pendiente para fases siguientes
- Ampliar `RESOURCE_TYPE_DICTIONARY` con los 3 casos sin mapeo detectados en el piloto.
- Verificación visual en el backoffice admin (UI) de los recursos importados — no realizada en esta pasada porque la ejecución real se hizo en un entorno temporal desechado inmediatamente después de la verificación por BD directa, no en el entorno de desarrollo local con frontend levantado.
