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

## Ampliación — importador de usuarios legacy (2026-08-06)

- `bun test packages/db/src/legacy-import/users.unit.test.ts packages/db/src/repository/legacy-users-import.unit.test.ts apps/cli/src/commands/import-legacy-users.unit.test.ts apps/cli/src/index.unit.test.ts` → **10 pass, 0 fail**.
- `bun run scripts/check-test-files.ts` → **OK**, todos los archivos TypeScript productivos tienen prueba asociada.
- Casos cubiertos: mapeo de `administrator`/`-`, estado activo e inactivo, rechazo de UID/correo inválidos, ausencia deliberada de credenciales, idempotencia por UID, colisión de email, errores aislados, `--dry-run` y `--limit`.
- `bun run check-types` no pudo completar por 16 errores ya presentes en artefactos locales bajo `local-data/uploads/elpx/**`; la salida no atribuye errores a archivos de esta ampliación.
- Dry-run real aislado: `import:legacy-users --source-file <ruta-absoluta>/exportados-usuarios/usuarios.json --dry-run --limit 4 --report-dir /tmp/...` → **4 importables, 0 errores, salida 0**. No se escribieron usuarios ni se usó el almacenamiento local del repositorio.
- Pendiente: piloto de importación real autorizado y prueba del flujo de activación de cuentas antes de tratar el lote completo.

### Actualización de política de rol (2026-08-06)

- La prueba de mapeo verifica que incluso un usuario legacy con `roles: "administrator"` queda como `editor`.

### Corrección de política de rol (2026-08-06)

- La prueba de mapeo verifica `administrator` → `admin` y `-` → `editor`.

### Cierre de PGlite en CLI (2026-08-06)

- Se añaden pruebas del cierre del cliente PGlite y de las rutas sin método `close()` o con error de cierre.

### Correcciones de revisión del PR #309 (2026-08-07)

- `bun test apps/cli/src/commands/import-legacy-users.unit.test.ts packages/db/src/repository/legacy-users-import.unit.test.ts packages/db/src/repository.unit.test.ts` ✅. Cubre conflictos de `dry-run` existentes y dentro del JSON, colisiones de email por mayúsculas/minúsculas, restricción única en base de datos y una importación concurrente.
- `bun run check-types` ✅ (0 errores).

### Segunda revisión del PR #309 (2026-08-12)

- La prueba de migraciones verifica que `0006_user_email_case_insensitive` figura en el journal, sustituye el nombre duplicado `0005` y contiene la comprobación previa de duplicados por `lower(email)`.
- La prueba del comando verifica que el cliente PGlite se cierra incluso si falla la lectura del JSON antes de generar el informe.
- Las pruebas de `--dry-run` verifican que `wouldImport` cuenta los registros importables y `imported` permanece en cero.

## Usuarios como `editor` y `--fix-roles` — 2026-11-03 (issue #507)

Rojo antes del cambio:

- `packages/db/src/legacy-import/users.unit.test.ts`: 6 fallos (tabla, ningún `author`, precedencia con varios roles, desconocidos como `editor`, nunca `curator`, aviso «entra como editor»).
- `packages/db/src/repository/legacy-users-import.unit.test.ts` y `apps/cli/src/commands/import-legacy-users.unit.test.ts`: no cargaban (`fixLegacyUserRole` y `runFixLegacyUserRoles` no existían).

Verde:

- `bun test packages/db/src/legacy-import/users.unit.test.ts packages/db/src/repository/legacy-users-import.unit.test.ts apps/cli/src/commands/import-legacy-users.unit.test.ts apps/cli/src/index.unit.test.ts` → **52 pass, 0 fail**.
- Mapeo: tabla completa, `admin` gana a `editor` con varios roles (también junto a desconocidos), desconocidos como `editor` y listados, nunca `curator` ni `author`.
- Corrección (PGlite): author → editor, repetible (la segunda pasada da `unchanged` y no duplica cuentas, credenciales ni perfiles), `--dry-run` sin escritura, `admin`/`curator`/`reader` intactos (`kept`), un `admin` del origen en `author` no cambia, un `administrador` de #309 en `editor` no sube a `admin`, cuenta nativa con el mismo correo intacta, y bloqueo, credenciales, perfil y recurso conservados.
- Comando: totales y registros con dry-run, real y repetición sobre la misma base; `--limit`; nombre del informe; sin correos en el informe; `--fix-roles` exige `--source-file`.
- `bun run check-types` ✅ (0 errores). `bun run lint` ✅ (sale 0; los 3 avisos son de ficheros que no toca este cambio).
- `bun run test`: unit 1338 pass y 4 fail. Son los 3 de #431 en `apps/api/src/routes/elpx-content.unit.test.ts` (los arregla #505) y un timeout de 5 s en `apps/api/src/index.unit.test.ts` con la máquina cargada, que pasa solo (23 pass). Integración 30 pass, 0 fail. UI 79 pass, 0 fail. Cobertura de líneas 90,97 % (≥ 90 %). En la pasada con cobertura fallan además los 4 de `catalog-area-keywords.unit.test.ts` por timeout del `beforeEach` (crear PGlite); pasan solos con `--timeout 60000` (4 pass).

## Errores sin datos de la base de datos — 2026-11-03 (revisión del PR #488)

Rojo antes del cambio (el informe llevaba `Failed query: insert into "account" … params: …,<hash sintético>,…`):

- `apps/cli/src/import-errors.unit.test.ts`: no cargaba (`import-errors.ts` no existía).
- `apps/cli/src/commands/import-legacy-users.unit.test.ts`: 6 fallos. La CHECK y el trigger sobre la credencial, el trigger de `--fix-roles`, el error inesperado al persistir, el error fuera del bucle y el registro de error de `--fix-roles` sin `code` ni `legacyUid`.
- `apps/cli/src/commands/import-legacy-procomun.unit.test.ts`: 3 fallos (guardar el recurso, aviso de `search_vector`, `--fix-published`). El test del error fuera de los bucles llegaba a `process.exit(0)` y cortaba la ejecución sin informar. Ahora el test intercepta `process.exit`.

Verde:

- `bun test apps/cli/src/import-errors.unit.test.ts apps/cli/src/commands/import-legacy-users.unit.test.ts apps/cli/src/commands/import-legacy-procomun.unit.test.ts apps/cli/src/commands/import-legacy-procomun.integration.test.ts` → **67 pass, 0 fail**.
- Usuarios (PGlite real, hash bcrypt sintético): con una restricción CHECK que rechaza la credencial, el informe escrito por el comando y la consola no llevan el hash, el correo, la consulta, los parámetros ni la fila (`Failing row`). El registro queda `{ outcome: "error", index: 0, legacyUid: "41", code: "constraint_violation", constraint: "test_rechaza_credencial", sqlState: "23514" }`. Con un trigger que pone el hash en el propio mensaje de Postgres, sale `db_error` (`P0001`). La transacción no deja la cuenta a medias y, al quitar el trigger, se reintenta y se importa con su hash.
- `--fix-roles` con un trigger que pone el correo en el error del UPDATE: informe y consola sin el correo.
- Recursos, con un error real de Drizzle sobre PGlite cuyo parámetro (y el mensaje de Postgres) es un correo: registro de error, aviso de `search_vector`, `--fix-published` y error fuera de los bucles sin el correo. Los mensajes propios del procesado se conservan (`import_error`, `invalid_record`). En la integración, la carrera real entre dos ejecuciones da `constraint_violation (elpx_projects_hash_key) [SQLSTATE 23505]`.
- `describeDbError`: Bun.SQL (SQLSTATE en `errno`), postgres.js (`constraint_name`), restricción que no es un identificador (no se copia), `EPERM` de Node (no es de la base de datos) y causas en ciclo.
- `bun run check-types` ✅ (0 errores). `bun run lint` (sin la exclusión de `.claude` en `biome.json`, restaurada después) ✅: 0 errores, los 3 avisos de siempre en ficheros que no toca este cambio.
- `bun run test`: unit 1363 pass y 3 fail, los 3 de #431 en `apps/api/src/routes/elpx-content.unit.test.ts` (los arregla #505). Integración 30 pass, 0 fail. UI 79 pass, 0 fail. `check-coverage`: 1393 pass y los mismos 3 fail; líneas 91,47 % (≥ 90 %), `apps/cli/src/import-errors.ts` al 100 %.

## Importador de itinerarios como colecciones — 2026-11-16 (#432)

Rojo antes del cambio:

- `packages/db/src/legacy-import/itinerary.unit.test.ts`: no cargaba (`itinerary.ts` no existía).
- `apps/api/src/routes/admin.unit.test.ts` y `apps/api/src/auth/roles.unit.test.ts`: 8 fallos. El propietario editor o author recibía 403 en `GET`, `PATCH` y las subrutas de su colección y no podía listarla. Tampoco había regla para que no publicara.

Verde:

- Mapeo, repositorio, CLI, migraciones y API: `itinerary.unit.test.ts` (16 pass con `publicator-email`), `legacy-collections.unit.test.ts` y `migrations.unit.test.ts` (32 pass), `import-legacy-itineraries.unit.test.ts` (5 pass), `import-legacy-itineraries.integration.test.ts` (6 pass), `admin.unit.test.ts` + `roles.unit.test.ts` + `crud-builder.unit.test.ts` (120 pass).
- Integración con el `itinerarios.json` real (quien publica, anonimizado) sobre PGlite: dos colecciones. La del itinerario 2 queda a nombre de la cuenta con su correo (con mayúsculas y un espacio al final en el JSON), publicada y con los cuatro ODE sembrados en el orden del JSON. El pódcast no está sembrado y se omite. La del itinerario 1 queda en borrador a nombre del usuario de sistema, con su ODE y sin el artículo. El informe no lleva `@` ni nombres. La segunda pasada da `unchanged` y no cambia id, slug ni `updated_at`. También se prueban `--dry-run` (no escribe ni crea el usuario de sistema), `--only`, `--limit`, una cuenta de baja (no la recibe), una bloqueada (sí) y una sin verificar que no es del importador de usuarios (no). Un error de restricción sale como `constraint_violation` con su SQLSTATE, sin la consulta.
- Prueba real con el CLI (`bun run apps/cli/src/index.ts import:legacy-itineraries`) y el JSON original sobre una PGlite nueva. En seco: `a_crear=2`, `sin_propietario=2`, `recursos_no_encontrados=7`. Real: `creadas=2`. Repetido: `sin_cambios=2`. Después se sembraron los cinco ODE adjuntos a la issue y la cuenta del autor del itinerario 2 (id `legacy-procomun:user:…`, sin verificar), y se relanzó: `actualizadas=2`, `sin_propietario=1`, `recursos_no_encontrados=2`. El itinerario 2 pasa a su autor (`owner: "linked"`) y a `published` con los cuatro ODE en orden. El 1 sigue en borrador a nombre del sistema con su ODE. Ningún informe lleva `@` ni los nombres de origen.
- `bun run check-types` ✅ (0 errores). `bun run check-test-files` ✅. `bun run check-tracking` ✅. `bun run lint` (con la exclusión de `.claude` renombrada en `biome.json` y restaurada después): 0 errores; los avisos son de ficheros que no toca este cambio.
- `bun run check-coverage`: 1784 pass, 0 fail; cobertura de líneas 92,13 % (≥ 90 %).
