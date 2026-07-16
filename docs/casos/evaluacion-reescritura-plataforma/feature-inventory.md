# Inventario funcional y de dominio

* Fecha: 2026-07-16 · Commit: `eea2fe7d`
* Fuentes: código (`apps/`, `packages/`, `e2e/`), `docs/casos/inventario-funcional-procomun-ng-actual/`, `docs/casos/matriz-decision-funcional-procomun/`, `docs/epics/`, `status.yaml`, rondas de QA manual.
* Clasificación: **(a)** implementada con tests · **(b)** implementada sin tests claros · **(c)** documentada, NO implementada · **(d)** abandonada/supersedida · **(e)** duplicada o especulativa.
* Regla aplicada: ninguna funcionalidad se declara prescindible por no entenderse su finalidad.

## 1. Capacidades por dominio funcional

| Capacidad | Clase | Evidencia |
| --- | --- | --- |
| Catálogo público (búsqueda `q`, filtros tipo/idioma/licencia, paginación en URL, grid/lista) | (a) | `apps/frontend/src/islands/catalog/`, `GET /api/v1/resources`; E2E de lectura en verde |
| Ficha pública de recurso (preview .elpx, descarga, adjuntos, metadatos, iframe embed) | (a) | `RecursoPage`/`ResourceDetailIsland`; tests HTTP en `index.unit.test.ts` |
| Búsqueda FTS PostgreSQL (tsvector, ranking, extracción PDF/DOCX/HTML) | (a) | `apps/api/src/fts/` + tests; **ADR-0026-FTS aún "Propuesto"** pese a estar implementada |
| Ordenación del catálogo | (c) parcial | UI la ofrece; backend sin parámetro `sort` (`CatalogIsland.tsx:354`, único TODO del repo) |
| Flujo editorial (draft→review→published→archived, transiciones por rol) | (a) con matices (b) | `packages/db/src/validation.ts`, `PATCH /api/admin/resources/:id/status`; los E2E de este flujo están en `test.fixme` |
| RBAC 5 roles (reader/author/editor/curator/admin) con matices finos | (a) | `apps/api/src/auth/roles.ts` + 7 suites; matices ganados por defectos (#158, #205, #221) |
| Autenticación Better Auth (email/password, sesiones 7d, OIDC condicional) | (a) parcial | `auth/config.ts` + tests de config; **ningún test ejercita login end-to-end real** (QA §2) |
| Registro público de cuentas | (b) con defectos | Corregido tras DEF-005 (S1); QA 26-may aún señala falta de verificación de email |
| API tokens Bearer + `/api/v1/publish/*` + rate limit | (a) | `auth/token-auth.ts` + tests; ADR-0024-api-tokens (no indexada) |
| Subidas resumables TUS multiarchivo (validación MIME/extensión/tamaño, `upload_sessions`, `media_items`) | (a) | `/api/uploads`, `@tus/server`; E2E de subida en `fixme` |
| Pipeline .elpx completo: análisis, extracción endurecida, preview origen opaco, generación desde adjuntos, exportación SCORM/IMS/EPUB/Web en navegador, embeds seguros | (a) | ADR-0020/0024/0026/0027; `services/elpx-safe-extract.ts` (~20 tests), `elpx-embed-policy` |
| Editor eXeLearning embebido (bridge postMessage) | (b) | `apps/api/static/exelearning-editor/` (vendorizado, descargable); sin E2E |
| Colecciones públicas + gestión editorial (portada, reordenación) | (a) | Feature epic-003 cerrada; tests de repositorio y rutas |
| Taxonomías gestionables (7 tipos, jerarquía parentId) | (a) con defectos abiertos | CRUD + API pública; DEF-016/017/018 (26-may) sobre filtros/edición sin corrección registrada |
| Backoffice admin (dashboard, recursos, colecciones, taxonomías, usuarios, ajustes de badges) | (a) parcial | `/admin/*`; E2E admin en `fixme`; DEF de UI abiertos (2026-07-02) |
| Gestión de usuarios (alta sin sesión, baja lógica, roles) | (a) | Corregida en DEF-019/020/021 con regresiones etiquetadas |
| Perfil personal (avatar, bio persistente, tabs, autoservicio `/api/v1/users/me/profile`) | (a) | Corregido DEF-004 con TDD (T-2026-06-23-005, T-2026-06-24-001) |
| Social ligero: ratings 1-5, favoritos, contador de descargas, feed de actividad | (a) | `apps/api/src/social/` + schema social; social.unit.test.ts (45 requests) |
| Comentarios | (c) | Tabla en `schema/social.ts`; sin API ni UI |
| Feeds Atom/RSS | (a) | `apps/api/src/feeds/` + ruta `/feeds`; ADR-0023-feeds (no indexada) |
| i18n 5 idiomas con Paraglide + rutas `:locale` | (a) parcial | Vigente tras la migración a Vite (plugin); E2E i18n mínimo (29 LOC) |
| Ayuda `/ayuda`, footer legal | (a) | Feature epic-003 cerrada |
| Auditoría de accesos y actividad (ENS) | (a) | `auth/audit.ts` → `api_access_logs`, `activity/log.ts` + tests |
| Moderación con denuncias (`reports`) | (b) | Tabla + migración 0003 (muerta) + rutas admin/reports; sin ronda QA dedicada |
| Dashboard de desarrollo `/dev/` (YAML) | (a) | ADR-0019; middleware en `vite.config.ts` con test |
| Seed determinista + CLI (`seed`, `user:create`…) | (a) | `apps/cli` + tests |

## 2. Documentadas y NO implementadas (no reconstruir sin decisión)

| Capacidad | Fuente | Estado de decisión |
| --- | --- | --- |
| Generación .elpx especializada por familia MIME | ADR-0020 aceptada; epic-002 tasks «si ADR-0020 se acepta» sin marcar | Aceptada sin implementar |
| Versionado de recursos | ADR-0028 (Propuesto) | Pendiente de decisión |
| Itinerarios (experiencia diferenciada; hoy solo `isOrdered` en colecciones) | Matriz F2-15 (P1, implementar) | Fase 2 |
| Banco Multimedia como entidad pública | Matriz F2-11/12 (P0, implementar/validar) | Fase 2 |
| Migración legacy (~78 800 ODEs, ~100 000 multimedia, ~109 700 usuarios) | Matriz F2-07/08/09 (P0) | Fase 2; sin acceso confirmado al esquema origen |
| Búsqueda facetada avanzada (materia, nivel, etiquetas, conteos, sort) | Matriz F2-02/03/04 (P0) | Fase 2 |
| Metadatos LOM-ES completos | Matriz F2-05 (P0) | Fase 2 |
| OAI-PMH / exportación bulk | Matriz F2-35 (P2) | Fase 2-3 |
| Comunidades, artículos, boletines, app móvil | Matriz F2-17/18/20/21 | «validar con INTEF» o «descartar/sustituir» |
| Recomendaciones, analítica de uso | Matriz F2-36/37 | Pospuestas |
| ENS: cierre operativo de tareas (CodeQL/Secret Scanning verificables, validación) | `docs/epics/ens/tasks.md` 0/12 marcadas | Documentación completa; épica estancada y ausente de `status.yaml` |

## 3. Abandonadas / supersedidas (no llevar a ninguna implementación futura)

* Preview estático de PRs (Cloudflare/GitHub Pages) — ADR-0002→0010→**0017 (eliminado)**.
* Uploads preview con IndexedDB — ADR-0012, eliminado por ADR-0017.
* Astro (framework y páginas `.astro`) — ADR-0018; quedan vestigios de naming (`islands/`) y deps.
* `PreviewApiClient` — eliminado; queda un comentario obsoleto en `api-client.ts:3`.
* Migraciones drizzle-kit tal como están — muertas (journal desincronizado); pendiente de decisión de consolidación, no de reconstrucción.

## 4. Duplicadas / especulativas

* Dos sistemas de autenticación (Better Auth + Bearer propio) — coexistencia justificada por casos de uso distintos, pero sin puerto común.
* Dos drivers PostgreSQL (bun-sql y `postgres` npm) — duplicidad sin justificación registrada.
* Dependencias vestigiales: `@electric-sql/pglite` y `drizzle-orm` en frontend (0 imports); `@testing-library/dom`/`react` declaradas y **sin un solo uso** en tests del frontend.
* Tabla `comments` sin API ni UI (especulativa hasta decisión F2-30).

## 5. Comportamiento implícito que DEBE preservarse

Conocimiento codificado solo en implementación y tests (pregunta 5 del encargo), con origen:

1. Matices RBAC: curator ve toda la cola `review` sin asignación (#158); conserva acceso a recursos que él curó tras el cambio de estado (`editorialStatus === "review" || assignedCuratorId === user.id`, #205); lista como admin pero solo gestiona `review`; gate global `/api/admin` en `author` con gates por sección (#221); editor tratado como author en uploads propios (#157).
2. Seguridad .elpx: rechazo de zip slip/symlink/zip bomb con rollback; CSP `sandbox` **sin** `allow-same-origin`; excepción consciente para el editor first-party; embeds solo vídeo cross-origin https, YouTube canonicalizado a nocookie; autenticación del relay por identidad de ventana (el origen es `null`).
3. IDOR corregido: `canManageResource` exigido en `/elpx/upload/:resourceId`, `/save/:resourceId`, `/generate` (#221); `storageDir` omitido en la config pública de uploads.
4. Compatibilidad de URLs antiguas de adjuntos (`/api/admin/uploads/:id/content` → `/api/v1/uploads/:id/content`) — promesa F2-01: no romper URLs/slugs/API pública.
5. Alta de usuario admin sin iniciar sesión (workaround con `auth.$context.password.hash`, DEF-019); baja lógica con `deleted_at` + filtro en listados (DEF-020); denegación de secciones admin por nivel con fallback al dashboard (DEF-021).
6. Workarounds de plataforma: `max_stack_depth` para PGlite, doble rama `unaccent`, exit-code 99/100 del runner, seed que crea el esquema en Docker.
7. Auditoría fire-and-forget: el fallo de auditoría nunca rompe la respuesta (decisión implícita relevante para ENS, sin documentar).
8. Regla histórica de editables (legacy, a preservar en migración): un archivo editable se acompaña de PDF.

## 6. Cobertura de pruebas del inventario (síntesis del informe QA)

* ~50 de ~106 handlers tienen ejercicio HTTP en tests (332 requests totales), pero con **autenticación simulada** (inyección de `mockUser`), no con sesiones reales.
* Los 17 E2E en `test.fixme` cubren exactamente el camino de escritura: registro, formulario de recurso, subida TUS, cola de curator (review→publish→archive), admin de usuarios/taxonomías — donde se concentraron los 47 DEF de QA manual.
* ~9 de 47 registros DEF (~19 %) tienen regresión automatizada etiquetada; `status.yaml` registra correcciones de la mayoría de los de mayo, pero las rondas de QA de 26-may y 02-jul no marcan ningún defecto como corregido (los IDs DEF se reinician por ronda; el estado real requiere cruce con issues de GitHub).
* Frontend: 0 tests de interacción (sin uso de testing-library); solo funciones puras y render estático.

## 7. Requisitos legales / normativos / de interoperabilidad

| Requisito | Fuente | Estado |
| --- | --- | --- |
| ENS Categoría MEDIA (RD 311/2022) | ADR-0015a, `docs/epics/ens/` (categorización, riesgos, SoA, continuidad) | Documentación completa; tareas técnicas 0/12 marcadas; auditoría/trazabilidad implementadas; CodeQL/Secret Scanning no verificables desde el repo |
| RGPD/LOPDGDD | `docs/epics/ens/evaluacion-rgpd.md` | Evaluado; **no contempla coexistencia dual de sistemas** |
| Accesibilidad (RD 1112/2018, WCAG 2.1 AA) | `e2e/tests/accessibility/wcag.e2e.ts` (10 tests axe, wcag2a+aa, en PRs) | Gate automatizado activo; sin auditoría manual documentada |
| Metadatos LOM-ES | ADR-0009 (perfil mínimo); matriz F2-05 | Perfil mínimo implementado; perfil completo pendiente (Fase 2) |
| Formatos de preservación (SCORM 1.2/2004, IMS, ePUB, HTML) | Matriz F2-09 (validar con INTEF) | Exportación .elpx→SCORM/IMS/EPUB/Web implementada en navegador (ADR-0024) |
| Expediente CE01698/2023 (ICA, 335 333,21 € sin IVA, 18 meses) | `docs/casos/contexto-procomun-legacy/` | Contexto contractual del legacy; PPT no obtenido |
