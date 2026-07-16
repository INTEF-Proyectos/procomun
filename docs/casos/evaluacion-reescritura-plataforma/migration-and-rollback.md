# Datos, migraciones, paridad y rollback

* Fecha: 2026-07-16 · Commit: `eea2fe7d` · Rutas verificadas en código (solo lectura).

## 1. Estado real de la capa de datos

**Tres definiciones del esquema, una sola viva:**

1. **Fuente viva**: `packages/db/src/setup.ts` — `SCHEMA_STATEMENTS` (296 líneas): 19 `CREATE TABLE IF NOT EXISTS`, 20 índices, extensión `unaccent` e índice GIN envueltos en `DO $$ ... EXCEPTION WHEN OTHERS` (tolerancia a PGlite), y 8 bloques `DO $$ ALTER TABLE ADD COLUMN ... EXCEPTION WHEN duplicate_column` (`created_by`, `bio`, `deleted_at`, `extracted_text`, `search_vector`, `extraction_status`, `extracted_at`, `extraction_error`).
2. **Migraciones drizzle-kit muertas**: `packages/db/migrations/` con 5 archivos y colisión de numeración (`0002_add_downloads_format.sql` y `0002_text_to_jsonb_metadata.sql`). El journal (`meta/_journal.json`) registra 3 entradas; `0002_add_downloads_format` y `0003_add_reports_table` están fuera del journal. `drizzle-kit migrate` existe como script pero **no se invoca** en `docker-entrypoint.sh`, Makefile, Dockerfile ni CI.
3. **Tipos**: `packages/db/src/schema/*.ts` (Drizzle).

**Aplicación por entorno:**

* Dev PGlite: `apps/api/src/db.ts` llama `createTables` al arrancar (idempotente) — solo en la rama PGlite.
* Producción Docker: `docker-entrypoint.sh` ejecuta el seed (que aplica `SCHEMA_STATEMENTS` vía `sql.unsafe`) y **continúa aunque falle** (`|| echo "Seed failed..., continuing"`), arrancando la API contra un esquema potencialmente desactualizado.

**El agujero del upgrade path (hallazgo crítico):** los bloques `ALTER` de `setup.ts` cubren solo 8 columnas; **no cubren** ni `downloads.format` ni los cambios de tipo TEXT→JSONB de `elpx_projects.elpx_metadata` y `activity_events.metadata` — esos cambios viven únicamente en migraciones que nadie ejecuta. Una BD de producción creada antes de esos cambios solo queda correcta ejecutándolas a mano; no hay registro de qué se aplicó. El riesgo ya se materializó una vez: hotfix T-2026-06-24-002 (`JSON.parse` sobre columna ya jsonb → 500 en el flujo .elpx de edición).

**Sin tooling de resguardo:** `grep pg_dump|backup` en Makefile/compose → 0 resultados. No hay backup/restore documentado ni probado.

## 2. Divergencias PostgreSQL ↔ PGlite (impacto en paridad)

| Divergencia | Evidencia | Efecto |
| --- | --- | --- |
| `unaccent` puede faltar en PGlite | `setup.ts:7-11`; doble rama en `fts/search.ts` | La búsqueda difiere entre dev y prod (acentos) sin que los tests lo detecten |
| Índice GIN tolerado a fallo | `setup.ts` (`EXCEPTION WHEN OTHERS THEN NULL`) | Planes de consulta distintos; silencioso |
| `max_stack_depth='7680kB'` (WASM) | `apps/api/src/db.ts` | Workaround solo-dev |
| Tres caminos SQL: `bun-sql` (API prod), PGlite (API dev), `postgres` npm (seed) | `db.ts:35,39`; `seed.ts` | Semánticas de tipos/errores propias por driver |
| Versiones: prod `postgres:17-alpine`, E2E `postgres:15-alpine` | `docker-compose.yml`; `e2e/docker-compose.postgres.yml` | Dos majors entre lo probado y lo desplegado |

Conclusión: la promesa «mismo motor en dev y prod» es sustancialmente cierta (mismo dialecto y esquema), pero **no es paridad estricta**: el comportamiento de producción del buscador (unaccent + GIN + PG17 + bun-sql) no lo ejercita hoy ningún test automatizado por defecto.

## 3. Plan de datos por estrategia

| Estrategia | Migración de datos | Verificación de paridad | Rollback | Coste relativo |
| --- | --- | --- | --- | --- |
| A/B (refactor / modular) | Ninguna. Trabajo recomendado: fuente única de esquema, migraciones versionadas con registro, E2E a PG17 | Test de paridad de esquema: diff de `pg_dump --schema-only` entre el camino de migraciones y el actual, en PGlite y PostgreSQL | `git revert` por lotes | Bajo |
| C (sustitución selectiva) | Ninguna (el esquema no cambia) | Tests de repositorio actuales + contract tests | revert | Bajo-medio |
| D (strangler) | Ninguna si se comparte la BD (opción sensata); exige congelar el esquema como contrato y ownership por tabla | Dual-run de endpoints (misma petición a ambas ramas, diff de respuesta JSON) | Re-enrutar la fachada al vertical viejo | Medio (coexistencia) |
| E (reescritura mecánica) | Trivial si conserva el esquema (`pg_dump/restore`; hoy solo hay seed) | Row counts + checksums por tabla + comparación de respuestas API sobre corpus grabado — **infraestructura que no existe** (0 contract tests, integración vacía) | Solo garantizable con freeze de escrituras o CDC; nada existe | Alto |
| F (reescritura + remodelado) | Transformación + doble verificación + coexistencia con sincronización o freeze | Como E + validación del modelo nuevo | Ídem, más caro | Muy alto |

## 4. La migración que de verdad importa

El requisito P0 real pendiente es la **ingesta desde Procomún legacy**: ~78 800 ODEs, ~100 000 multimedia, ~109 700 usuarios desde Drupal 9/MariaDB + Agrega3 (matriz F2-07/08/09), sin acceso confirmado aún al esquema origen. Consecuencias para la decisión:

1. **El presupuesto de riesgo de datos ya está comprometido en esa migración.** Gastarlo en migrar la propia BD de NG (hoy: datos de seed) por una reescritura interna es resolver un problema que no existe.
2. **La volumetría legacy invierte la carga de la prueba del esquema**: 79k recursos con FTS, facetas y multimedia estresarán decisiones actuales (keywords como texto plano, `resource_subjects` sin índice propio, media en disco local). Es argumento para **evolucionar el esquema con migraciones reales antes de la ingesta**, no para reescribir la plataforma.
3. Cualquier estrategia debe dejar operativo un mecanismo de migración versionado ANTES de cargar el legacy: con 79k filas ya no valdrá «recrear la BD».
4. El patrón Strangler Fig sí aplica a la coexistencia NG↔Drupal durante esa ingesta (fachada de catálogo, redirecciones, retirada progresiva del legacy) — reservarlo para esa épica.

## 5. Gates de datos exigibles (a cualquier estrategia, y bloqueantes para una reescritura)

1. Fuente única de esquema; journal consistente sin colisiones de numeración.
2. Mecanismo de migración con registro, aplicado en dev PGlite, E2E y Docker prod, y **probado sobre una BD con datos preexistentes** (test de upgrade, no solo de instalación limpia).
3. Contract tests de API sobre corpus fixture ejecutables contra dos implementaciones (hoy inexistentes; sin ellos no hay oráculo de paridad).
4. Suite ejecutada contra PostgreSQL 17 real en CI (cierra las ramas unaccent/GIN y la brecha 15→17).
5. Verificación de paridad definida por adelantado: row counts + checksums por tabla + diff de respuestas API; umbral: cero diferencias inexplicadas.
6. Rollback ensayado: backup/restore documentado y probado; en strangler, vuelta de enrutado por vertical.
7. Decisión previa sobre el esquema destino de la ingesta legacy, para no migrar dos veces.
