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

## Fase 1 — pruebas manuales del usuario y dos bugs adicionales encontrados (2026-07-10)

Al probar el comando manualmente contra su entorno de desarrollo local (`local-data/`, vía `make cli`), el usuario encontró dos problemas no cubiertos por los tests automatizados (ambos con proceso corto de vida — la suite de tests fuerza su propia salida y no los detecta; el servidor API tampoco, porque nunca necesita terminar):

1. **El proceso se quedaba colgado tras completar la importación.** Causa: `apps/api/src/services/elpx-safe-extract.ts` (código preexistente, ADR-0026a) lanza `unzip` con `stdout: "pipe", stderr: "pipe"` pero nunca lee esos streams. `unzip -o` es verboso (una línea por fichero extraído); con `.elpx` de decenas/cientos de entradas el buffer del pipe se llena, el proceso `unzip` se bloquea escribiendo y `proc.exited` nunca se resuelve. Fix: `stdout`/`stderr` a `"ignore"` (igual que el otro `Bun.spawn` en `elpx-processor.ts`, que ya lo hacía bien). Verificado: la importación completa de los 9 ejemplos pasó de colgarse indefinidamente a completarse en ~2s.
2. **Tras arreglar (1), el proceso salía con código 99 en vez de 0.** Causa: PGlite (Postgres compilado a WASM vía Emscripten) fija `process.exitCode = 99` como red de seguridad (`quit_()` interno) cuando el proceso Node/Bun va a terminar sin haber cerrado explícitamente la conexión — reproducible incluso llamando a `process.exit(0)` a mano, porque algo en el runtime de PGlite muta `process.exitCode` de forma asíncrona antes de que se ejecute esa línea. Fix: `apps/cli/src/commands/import-legacy-procomun.ts` ahora cierra `db.$client` (si expone `.close()`) antes de `process.exit()`, y calcula el código de salida en una variable local en vez de leer `process.exitCode` (que puede haber sido mutado por PGlite).

Ambos bugs eran preexistentes en la infraestructura reutilizada, no introducidos por el importador — pero solo se manifiestan en un proceso de vida corta como este CLI, por lo que no habían aparecido hasta esta prueba manual. Quedan corregidos y verificados con `bun test` (783/783) más una reproducción manual: ejecución completa de los 9 ejemplos, `EXIT_CODE=0`, ~2.3s de duración total (antes: cuelgue indefinido).

### Pendiente
- Verificación visual en el backoffice admin (UI) por parte del usuario — pendiente de confirmación tras aplicar estos dos fixes.
- Considerar si `elpx-safe-extract.ts` debería drenar/loguear stdout de `unzip` en vez de ignorarlo del todo, si en el futuro se necesita diagnosticar fallos de extracción con más detalle (fuera de alcance de esta épica).
