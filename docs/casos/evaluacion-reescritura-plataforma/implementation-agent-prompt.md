# Prompt de ejecución posterior — Simplificación incremental de Procomún NG

> **NO ejecutar durante la evaluación.** Este prompt es autónomo y está pensado para una segunda ejecución, únicamente después de que una persona revise y acepte la ADR-0030. Si la ADR-0030 no está en estado `Aceptado`, detente y repórtalo.

---

Actúa como un equipo de ejecución multiagente sobre el repositorio `INTEF-Proyectos/procomun`. Tu misión es ejecutar el programa de **simplificación incremental** aprobado en la ADR-0030 (opción B: monolito modular evolutivo, que incluye la opción A como primer tramo y dos sustituciones selectivas justificadas). No es una reescritura: el sistema sigue entregando durante todo el programa.

## Objetivo

Restaurar las puertas de calidad rotas, consolidar la fuente única de esquema de datos, construir la suite de caracterización que falta y establecer límites de módulo verificables — manteniendo los 702+ tests en verde, la cobertura ≥90 % y el comportamiento observable intacto.

## Alcance y fuera de alcance

**Dentro**: `package.json` (raíz y workspaces, solo lo especificado), `apps/api`, `apps/frontend`, `apps/cli`, `packages/db`, `scripts/`, `e2e/`, `.github/workflows/`, documentación asociada.
**Fuera**: cambiar Hono, Drizzle, Better Auth, React Router, Vite, Bun, PostgreSQL o PGlite por otras tecnologías; introducir microservicios; rediseñar el modelo de dominio; implementar features de Fase 2 (búsqueda facetada, Banco Multimedia, itinerarios, migración legacy); tocar el pipeline de seguridad .elpx salvo para añadir tests; marcar como supersedida ninguna ADR vigente.

## Tecnologías aprobadas / no aprobadas

* **Aprobadas**: `@biomejs/biome` (2.x, el `biome.json` existente declara schema 2.4.8), `drizzle-kit` para regenerar migraciones, PostgreSQL 17 en CI, todo lo ya presente en el lockfile.
* **Explícitamente NO aprobadas**: Elysia, Fastify, Kysely, Prisma, Next.js, o cualquier framework/ORM alternativo; nuevas dependencias de observabilidad (se decidirán en ADR aparte); cualquier dependencia nueva no listada aquí sin ADR previa.

## Comportamiento que debe preservarse (contrato)

1. Shape JSON de toda la API pública (`/api/v1/*`, `/feeds`) — prohibido romper URLs, slugs o contratos (matriz F2-01).
2. Matriz RBAC con sus matices ganados por defectos: curator ve toda la cola `review` (#158) y conserva acceso a lo que curó (`editorialStatus === "review" || assignedCuratorId === user.id`, #205); gate global `/api/admin` en `author` con gates por sección (#221); editor como author en uploads propios (#157); alta admin sin sesión (DEF-019); baja lógica con `deleted_at` (DEF-020); denegación de secciones con fallback (DEF-021).
3. Seguridad .elpx: extracción endurecida con rollback; CSP `sandbox` **sin** `allow-same-origin`; excepción del editor first-party; política de embeds (vídeo solo cross-origin https, YouTube→nocookie); `canManageResource` en `/elpx/upload|save|generate`; `storageDir` nunca expuesto.
4. Compatibilidad de URLs antiguas de adjuntos; auditoría fire-and-forget (`api_access_logs`); i18n de 5 idiomas con rutas `:locale`; workarounds de plataforma (`max_stack_depth` PGlite, doble rama `unaccent`, exit-code 99/100 del runner) hasta que se retiren con evidencia.

## Funcionalidades que quedan fuera (no reconstruir, no «aprovechar para»)

Comentarios (tabla sin API), generación .elpx especializada (ADR-0020 sin implementar), versionado (ADR-0028 propuesta), itinerarios, Banco Multimedia, comunidades/artículos/boletines, OAI-PMH, recomendaciones. Si un lote «necesitaría» una de estas, detente y repórtalo.

## Arquitectura objetivo (límites verificables, no reescritura)

* `hono` importado solo bajo `apps/api/src/routes/` y `apps/api/src/app/`.
* `drizzle-orm` importado solo en `packages/db` y `apps/api/src/db.ts`.
* Componentes frontend sin `fetch(` directo: todo vía la interfaz `ApiClient` (dividida por dominios).
* Puerto de auth (`apps/api/src/auth/port.ts`) como única superficie que el resto del código usa para identidad/roles.
* Una sola fuente de esquema: `packages/db/src/schema/*.ts` como verdad + migraciones drizzle-kit versionadas aplicadas con registro en dev/E2E/prod; `setup.ts` derivado o retirado.
* Un solo driver PostgreSQL (`drizzle-orm/bun-sql`); retirar `postgres` npm del seed.

## Estrategia por fases (lotes ordenados, cada uno entregable y reversible)

**Lote 0 — Reparaciones triviales** (sin dependencias). **Ejecutado en su mayor parte en la PR #272** (2026-07-16, adelantada durante la evaluación): biome real instalado con las reglas recomendadas completas y todos los errores del linter arreglados en código (sin exclusiones, rebajas ni supresiones nuevas), deps vestigiales del frontend retiradas, `typescript`/`@types/*` movidas a dev, comentario de `api-client.ts` corregido, `test-regex.ts` eliminado. **Pendiente del Lote 0**: unificar el driver pg (retirar `postgres` npm del seed) y verificar que la PR #272 esté fusionada antes de continuar (si no lo está, coordinar con esa rama en vez de duplicar el trabajo).

**Lote 1 — Typecheck a cero con ratchet**: paso de CI que falla si `bunx tsc --noEmit | grep -c 'error TS'` supera el último valor registrado; quemar los 635 por tipología (TS2571 en `packages/db/src/repository/*` primero: tipar los retornos de `db.execute` una vez en `shared.ts`); al llegar a 0, retirar `continue-on-error: true` de `ci.yml`. Documentar cada bug real que aflore.

**Lote 2 — Caracterización**: (a) des-fixmear los 17 E2E de escritura (`auth/login-logout`, `author/backoffice`, `admin/admin-panel`, `curator/review`) — si un flujo falla por defecto de producto, corregir el defecto primero con TDD; (b) contract tests black-box de la API pública con login real (sin `mockUser`): ~3 casos por endpoint (shape/roles/validación); (c) poblar `test:integration` con ≥1 flujo multi-endpoint por dominio; (d) job de CI con la suite contra PostgreSQL 17 real.

**Lote 3 — Fuente única de esquema**: regenerar migración baseline desde `schema/*.ts`; test de paridad por diff de `pg_dump --schema-only` (camino migraciones vs esquema actual) en PGlite y PG17; entrypoint Docker pasa a migraciones con registro (eliminar el `|| continuing` silencioso); resolver la colisión `0002_*` y el journal; test de upgrade sobre BD con datos preexistentes; añadir tooling `pg_dump`/restore documentado.

**Lote 4 — Puertos y límites**: `auth/port.ts`; dividir la interfaz `ApiClient` por dominios; gates de grep del apartado «Arquitectura objetivo» como tests de CI.

**Lote 5 — Divisiones de módulos** (solo los que mezclan responsabilidades): `EditarPage.tsx` (799 líneas → workflow/uploader/editor/formulario), `http-api-client.ts` (716). Con los E2E editoriales del Lote 2 en verde ANTES de tocar `EditarPage`.

Orden de verticales para el Lote 2b (contract tests), de menor a mayor complejidad: taxonomías → colecciones → usuarios/perfil → social → recursos+editorial → uploads/TUS → elpx → feeds/tokens/publish.

## Guía de refactorización

* Un cambio de comportamiento observable = un defecto, salvo aceptación humana escrita en el PR.
* Nunca borrar un test para poner un lote en verde; los `test.fixme` solo se retiran haciéndolos pasar.
* Inmutabilidad documental: añadir secciones fechadas, no borrar historial (`status.yaml` claves `T-YYYY-MM-DD-NNN`).
* Paridad archivo-test vigente (regla 16 de AGENTS.md); TDD para toda corrección de defecto.

## Gates por lote (todos verificables por comando)

Cada lote se cierra solo si: `bun run test` en verde con cobertura ≥90 %; `bun run lint` (real) en verde; ratchet de tsc no sube; E2E chromium sin regresión (`CI=1 bun run test:e2e`); `git diff --check` limpio; y el gate específico del lote (Lote 0: lint real demostrado con error inyectado; Lote 1: conteo tsc; Lote 2: 0 fixme + conteo integración > 0 + job PG17 verde; Lote 3: diff de pg_dump vacío + upgrade test; Lote 4: greps a 0; Lote 5: E2E editorial verde antes y después).

## Organización de agentes

* **1 implementador por lote** (no revisa su propio trabajo).
* **2 revisores adversariales independientes por lote**, con contexto separado, que parten del diff y los artefactos (no de las justificaciones del implementador), con la instrucción «assume the code is wrong»; buscan regresiones de comportamiento, contratos rotos y gates falseados.
* **1 agente corrector** que aplica los hallazgos aceptados de los revisores (el implementador no se autocorrige sin revisión).
* **Validación humana obligatoria** al cierre de cada lote antes de fusionar: una persona aprueba el PR.

## Ramas, commits y PRs

* Una rama por lote: `refactor/lote-0-quality-gates`, `refactor/lote-1-typecheck`, etc.; worktrees si se trabaja en paralelo. Prohibido `git reset --hard`, `git stash` sobre trabajo ajeno, force push y mezclar cambios de otros en el PR.
* Commits en inglés, pequeños y temáticos (`fix: replace wrong biome package with @biomejs/biome`, `test: unfixme curator review e2e flow`).
* PRs pequeñas y revisables: un lote puede dividirse en varias PRs (p. ej. Lote 1 por workspace); ninguna PR debería superar ~600 líneas de diff productivo salvo lotes mecánicos justificados (renombrados, tipado en masa) donde se explicará el patrón en la descripción.

## Rollback y condiciones de parada

* Cada lote es un conjunto de commits revertibles; si un gate se rompe tras fusionar, revert antes de investigar.
* **Detente y repórtalo** si: un lote excede 2× su rango de calendario; el lint real destapa >1 semana de diagnósticos; la conversión a login real destapa >3 defectos de composición de gates (se re-prioriza como trabajo de seguridad); aparece cualquier necesidad de tocar tecnologías no aprobadas; alguien propone «aprovechar» para rediseñar producto.
* Si el piloto comparativo (brazo 2 de `pilot-plan.md`) se ordena ejecutar y muestra ventaja clara de regeneración, no continúes: reporta para reabrir la ADR-0030.

## Actualización documental al cierre de cada lote

Añadir entrada `T-YYYY-MM-DD-NNN` en `status.yaml` con los resultados de los gates; actualizar la tabla de hipótesis H1–H12 de `docs/casos/evaluacion-reescritura-plataforma/validation.md` (columna «Resultado») con el valor medido; registrar decisiones técnicas nuevas como ADR usando `.templates/adr-template.md` (siguiente número libre del `decision-log.yaml`, vigilando las colisiones conocidas 0023/0024/0026); no marcar ADRs anteriores como supersedidas sin aprobación humana.
