# Evaluación tecnológica pieza a pieza

* Fecha: 2026-07-16 · Commit: `eea2fe7d` · Método: inspección de código y git (solo lectura), cifras reproducibles.
* Pregunta por pieza: ¿es fuente real de complejidad/coste medible, o simple correlación? ¿Qué costaría sustituirla y qué se perdería?

## Resumen de veredictos

| Pieza | Veredicto | ¿Sustituir? |
| --- | --- | --- |
| `biome@0.3.3` (lint/format) | **Defecto demostrado: no-op total** | **Sí, obligado** — **ya ejecutado en la PR #272** tras esta evaluación (§1) |
| Hono | Sin evidencia de problema | No |
| Drizzle ORM | Coste parcial (triple fuente de esquema), no atribuible al ORM en sí | No (degradar su papel: una sola fuente de esquema) |
| Better Auth | Coste puntual demostrado (flujos opinionados) | No (aislar tras puerto propio) |
| React Router + Vite | Sin evidencia de problema tecnológico; el coste es el volumen (17,2k LOC) y vestigios | No |
| PGlite en desarrollo | **Coste demostrado** (workarounds), y valor demostrado (tests sin Docker) | No retirar; acotar su papel |
| Bun | Coste puntual (workaround exit-code del runner) + lock-in moderado asumido por ADR-0001 | No (restricción de producto) |
| Driver pg npm (`postgres`) en CLI | Duplicidad sin justificación registrada | Sí (consolidar en un driver) |

## 1. Herramientas de calidad — el único defecto tecnológico grave

* [H] La dependencia raíz `"biome": "0.3.3"` **no es el linter Biome**: es un paquete homónimo abandonado («A simple way to manage environment variables on a per-project basis»). Su binario acepta `lint .`/`format .` y sale 0 sin analizar nada.
* [H] `bunx @biomejs/biome format .` (paso de CI) resuelve al mismo binario local equivocado (`node_modules/.bin/biome`), por lo que el format-check de CI también es un no-op. `@biomejs` no existe en `node_modules`.
* [H] Existe un `biome.json` con schema 2.4.8 que nunca se ejecuta.
* [H] El typecheck de CI (`bunx tsc --noEmit`) corre con `continue-on-error: true` y hoy reporta 635 errores (ver `baseline.md` §2).
* [I] Consecuencia: el proyecto ha operado ~4 meses sin lint, sin format-check efectivo y sin typecheck bloqueante. Las puertas reales han sido los tests (702) + cobertura ≥90 % + paridad archivo-test. Esto explica que el problema no se detectara: los comandos salían 0.
* **Actualización 2026-07-16:** el defecto de lint/format quedó **corregido en la PR #272** (biome real 2.4.8, formateo masivo y 0 errores de lint con las reglas recomendadas completas — sin exclusiones, rebajas ni supresiones nuevas; verificado que el gate falla ante un error inyectado). El coste real de la reparación in situ, incluidos los arreglos de código de hooks y accesibilidad, fue de ~1 día con agentes — dato relevante para la matriz de alternativas: era exactamente la medición que faltaba sobre la «vía barata». El typecheck sigue pendiente (Lote 1).

## 2. Hono (`apps/api`)

* [H] 51 archivos importan `hono` (32 productivos); 19 `new Hono()`. Composición: `app.ts` (13 líneas) + `app/routes.ts` (montaje) + `routes/crud-builder.ts` (fábrica CRUD genérica, 176 líneas) que concentra list/get/create/update/delete + roles + validación.
* [H] Better Auth NO depende de Hono: se monta como handler fetch-estándar (`auth.handler(c.req.raw)`, `app/middleware.ts:33`).
* [H] Incidencias atribuibles a Hono en 417 commits y `status.yaml`: ninguna encontrada.
* [I] Coste de sustitución: medio (19 puntos de montaje + crud-builder); beneficio demostrable de Elysia/`Bun.serve`/Fastify: **ninguno medido**. No hay benchmark propio que muestre a Hono como cuello de botella (arranque 0,6 s; sin datos de carga).

## 3. Drizzle ORM (`packages/db`)

* [H] 33 archivos productivos lo importan; fachada de repositorios por dominio (`packages/db/src/repository/`) lo aísla razonablemente.
* [H] El buscador FTS es SQL PostgreSQL nativo puro (`apps/api/src/fts/search.ts`, 305 líneas: `to_tsvector`, `websearch_to_tsquery`, `ts_rank`, `unaccent`, GIN) donde Drizzle solo transporta (`db.execute(sql\`...\`)`).
* [H] **Triple definición de esquema**: (1) `packages/db/src/setup.ts` — `SCHEMA_STATEMENTS`, SQL a mano, **la única fuente aplicada** (20 `CREATE TABLE IF NOT EXISTS` + 8 bloques `DO $$ ALTER TABLE ADD COLUMN` — una tabla menos que las 21 del esquema Drizzle: falta `api_access_logs`, ver `migration-and-rollback.md` §1); (2) `packages/db/migrations/` — 5 archivos drizzle-kit **muertos** (journal `meta/_journal.json` con 3 entradas; `0002_add_downloads_format.sql` y `0003_add_reports_table.sql` fuera del journal; colisión de numeración `0002_*`; `drizzle-kit migrate` no se invoca en entrypoint, Makefile ni CI); (3) `packages/db/src/schema/*.ts` — tipos.
* [H] Riesgo materializado una vez: hotfix T-2026-06-24-002 (`status.yaml`) — una ruta siguió haciendo `JSON.parse` sobre una columna que la migración 0002 había convertido a `jsonb`.
* [H] **No hay camino de upgrade para BD con datos**: en Docker, `docker-entrypoint.sh` ejecuta el seed (que aplica `SCHEMA_STATEMENTS`) y **continúa aunque falle**; los cambios de tipo TEXT→JSONB solo existen en migraciones que nadie ejecuta. No hay tooling de backup (`pg_dump`/restore) en Makefile ni compose.
* [I] Veredicto: la complejidad es real pero pertenece a la **gestión del esquema**, no al ORM. ¿Es necesario un ORM? Lo que Drizzle aporta hoy: tipado del esquema y el `drizzleAdapter` de Better Auth (acoplamiento auth↔ORM). Sustituirlo por Kysely/Prisma/SQL directo no eliminaría la triple fuente (se resuelve consolidando fuentes con el ORM actual) y añadiría el coste de re-integrar Better Auth. Sin beneficio verificable, se mantiene.

## 4. Better Auth

* [H] Configuración en `apps/api/src/auth/config.ts` (97 líneas): email/password, plugin admin con access-control propio, OIDC (PKCE) condicional, sesiones 7 días, hooks de auditoría, `drizzleAdapter(provider:"pg")`. Posee 4 tablas (`user/session/account/verification`).
* [H] Fricción demostrada: DEF-019 — el alta de usuarios desde admin usaba el endpoint público de sign-up, que iniciaba sesión como el usuario creado; la corrección alcanzó internals (`auth.$context.password.hash`), API privada que no sobrevive a cambios de versión mayores.
* [H] Existe un **segundo sistema de autenticación** paralelo: Bearer tokens propios con rate-limiter in-memory (`apps/api/src/auth/token-auth.ts`, 71 líneas) para `/api/v1/publish/*` (ADR-0024-api-tokens, no indexada).
* [I] Veredicto: coste puntual, no estructural. Sustituirlo reimplementaría OIDC + sesiones + RBAC (riesgo de seguridad neto). Mitigación barata: puerto propio (`auth/port.ts`) que encapsule los puntos de contacto. El rate-limiter in-memory no sobrevive a multi-instancia — restricción a documentar, no defecto actual.

## 5. React Router + Vite (`apps/frontend`)

* [H] El workspace más grande: 17 168 LOC en 113 archivos. Estructura heredada de la era Astro: el directorio se sigue llamando `islands/` (hoy componentes React normales agrupados por feature).
* [H] Vestigios medidos: `@electric-sql/pglite` y `drizzle-orm` como dependencias del frontend con **0 imports** en `src/`; `typescript`, `@types/*` y `@testing-library/*` como dependencias runtime; comentario obsoleto en `api-client.ts:3` citando el eliminado `PreviewApiClient`.
* [H] Build 919 ms; bundle principal 92,56 kB gzip; page-chunks entre 0,4 y 15 kB gzip (mayor: AdminPage 14,99 kB; uploader Uppy 33,58 kB). No hay presupuesto de bundle definido en el repo contra el que evaluar, pero no hay evidencia de problema.
* [H] ADR-0023 (2026-05-26) ya evaluó sustituir Vite por el bundler de Bun y se **rechazó** con bloqueos técnicos concretos (React Fast Refresh, plugin Paraglide) — precedente de la disciplina «no cambiar tecnología sin beneficio demostrable».
* [I] Veredicto: no hay caso para cambiar framework o bundler. El coste real es de organización interna (módulos de 600–800 líneas, cliente HTTP monolítico de 716 líneas que es el hotspot de cambios del repo con 46 modificaciones combinadas con `api-client.ts`).

## 6. PGlite vs PostgreSQL

* [H] Selección por entorno en `apps/api/src/db.ts`: con `DATABASE_URL` → `drizzle-orm/bun-sql`; sin él → PGlite en `local-data/` (y solo esa rama llama a `createTables`).
* [H] Divergencias medidas, todas con mitigación «degradar en silencio»: (1) `unaccent` puede no existir en PGlite → doble rama en FTS y `DO $$ ... EXCEPTION` en setup; (2) índice GIN tolerado a fallo; (3) workaround `SET max_stack_depth = '7680kB'` para PGlite-WASM bajo E2E; (4) tres caminos de ejecución SQL (bun-sql en API prod, PGlite en dev, `postgres` npm en seed).
* [H] Versiones divergentes: producción `postgres:17-alpine`, E2E `postgres:15-alpine` — dos majors entre lo probado y lo desplegado.
* [H] El comportamiento de producción del buscador (unaccent + GIN + Postgres 17 + bun-sql) **no lo ejercita ningún test automatizado por defecto** (los E2E con Postgres real son opcionales y usan v15).
* [I] Veredicto: el balance de PGlite es positivo (702 tests en ~30 s sin Docker, mismo dialecto que producción) pero la «paridad» no es estricta y tiene precio de mantenimiento. Recomendación derivada: mantener PGlite (restricción de producto y valor real en tests) acotando su papel, y cerrar la brecha con una ejecución de suite contra PostgreSQL 17 real en CI.

## 7. Bun

* [H] Usos específicos: `Bun.file` (11), `Bun.env` (7), `Bun.spawn`/`import.meta.dir`/`Bun.$` (18), `bun:test` en 87 archivos, `drizzle-orm/bun-sql` (1). `Bun.serve` directo: 0 (se usa `export default { fetch }`).
* [H] `scripts/run-bun-suite.ts` (176 líneas) existe por dos motivos: descubrir suites por convención de sufijo y **normalizar exit-codes 99/100 de `bun test`** cuando la salida confirma 0 fail (incidencia del runner con PGlite-WASM, T-2026-03-31-001/002). Riesgo documentado: puede enmascarar cierres sucios reales.
* [I] Lock-in moderado-alto asumido conscientemente por ADR-0001 (restricción de producto). Sin evidencia de impedimento crítico que justifique cuestionarla.

## 8. Dependencias

* [H] 44 declaraciones directas entre raíz y workspaces (~32 paquetes únicos); 460 paquetes resueltos en `bun.lock`.
* [H] Duplicidades: `@electric-sql/pglite@0.5.4` en 5 manifiestos (uno vestigial), `drizzle-orm` en 4 (raíz con `^`, workspaces con pin exacto — inconsistencia de estrategia), `better-auth` ×2, `postgres` ×2, `typescript` ×2 (una como runtime dep).
* [H] Pinning mixto: exactos (hono, better-auth, uppy, pglite) frente a rangos `^` (react, vite, cheerio, mammoth, pdf-parse, feed, paraglide).
* [I] Ninguna dependencia «pesada» injustificada: cheerio/mammoth/pdf-parse sirven a la extracción FTS; uppy+tus son las dos mitades cliente/servidor del protocolo de subidas; feed sirve `/feeds`.

## 9. Hotspots de cambio (git)

* [H] 417 commits; 138 contienen «fix» (33 %); 27 de los últimos 60 (45 %); 0 reverts; 23 commits citan `DEF-`.
* [H] Archivos más modificados (excluyendo docs/status/lockfile): los `package.json` (44+31+26+25+19 cambios), `http-api-client.ts` (23) + `api-client.ts` (23), `Makefile` (21), `seed.ts` (20), `setup.ts` (18). Dos fósiles de la era Astro entre los más tocados históricamente (`preview-api-client.ts` 20, `index.astro` 16 — ambos eliminados).
* [I] Lectura: el churn se concentra en manifiestos (rotación de dependencias/scripts) y en la capa cliente-HTTP del frontend; no hay un módulo de dominio «maldito» que concentre regresiones.

## 10. Respuestas directas a las preguntas del encargo

* **¿Puede mantenerse Bun, PostgreSQL y PGlite con una arquitectura más sencilla?** Sí: ninguno de los costes medidos exige cambiarlos; los costes viven en la gestión del esquema, las puertas de calidad rotas y la organización interna del frontend.
* **¿Es necesario un ORM?** No es imprescindible (el FTS y el esquema vivo ya son SQL), pero retirarlo hoy costaría la re-integración de Better Auth y el tipado, sin beneficio medido. Se mantiene con papel acotado.
* **¿Drizzle sigue siendo adecuado?** Sí, condicionado a consolidar una única fuente de esquema con migraciones reales aplicadas por herramienta.
* **¿Aportaría mejora demostrable Kysely/Prisma/Bun.sql/SQL directo?** No hay medición propia que lo demuestre; cambiar por uniformidad está vetado por las reglas del proyecto.
* **¿Hono sigue siendo adecuado?** Sí. **¿Elysia/Bun.serve/Fastify aportarían mejora demostrable?** No hay evidencia propia; no se identificó cuello de botella atribuible a Hono.
* **¿React Router con Vite sigue encajando?** Sí; la alternativa ya fue evaluada y rechazada en ADR-0023 con bloqueos técnicos vigentes.
* **¿El problema requiere cambiar framework o mejorar límites/contratos/estructura?** Lo segundo: los defectos medidos (esquema, gates, hotspot del cliente HTTP, RBAC disperso) son de límites y contratos, no de frameworks.
