# Roadmap

## Estado: Fase 1 — MVP de catálogo

Catalogo MVP operativo con busqueda facetada, CRUD unificado, flujo editorial completo, editor eXeLearning y front unificado en React Router + Vite. La implementación actual ya no usa preview estático en GitHub Pages.

---

## Fase 0 — Fundación del sistema ✅

**Objetivo**: establecer las bases técnicas, documentales y de arquitectura antes de escribir código de negocio.

| Hito | Estado |
|------|--------|
| AGENTS.md y sistema de skills definido | Completado |
| Visión y mapa de capacidades | Completado |
| ADR stack base (TypeScript + Bun) | Completado — ADR-0001 |
| ADR capa API | Completado — ADR-0003 (Hono) |
| ADR capa frontend | Completado — ADR-0004 (decisión inicial) + ADR-0018 (implementación actual en React Router + Vite) |
| ADR base de datos principal | Completado — ADR-0005 (PostgreSQL) |
| ADR ORM y capa de acceso a datos | Completado — ADR-0006 (Drizzle ORM) |
| ADR infraestructura Docker y operaciones | Completado — ADR-0015 (Evo1) |
| Modelo de dominio v0 | Completado — borrador en `docs/producto/modelo-de-dominio.md` |

---

## Fase 1 — MVP de catálogo

**Objetivo**: tener un catálogo funcional con recursos, metadatos básicos, búsqueda y API.

| Épica | Estado |
|-------|--------|
| Modelo de metadatos mínimo | Completado — ADR-0009 aceptada, validación mínima y CRUD real de recursos entregados |
| Arquitectura base del sistema | Completado — monorepo, Hono, React Router + Vite, Drizzle, PGlite dev |
| Autenticación y autorización | Completado — Better Auth (password + OIDC), RBAC con 5 roles (author/editor/curator/admin + reader público), CLI usuarios |
| Flujo editorial de recursos | Completado — stepper visual, transiciones por rol (author→review, editor→publish directo, curator→approve/reject), campo createdBy, colores semafóricos |
| Busqueda y facetas iniciales | Completado — sidebar facetada (tipo, idioma, licencia), paginacion numerada, grid/list toggle, filtros dinamicos desde taxonomias |
| API REST publica v1 | Completado — listado y detalle de recursos publicados, paginacion, filtros, taxonomias y colecciones publicas |
| Importacion piloto desde CSV | No iniciada |
| Frontend publico minimo | Completado — catalogo con sidebar, ficha de recurso con layout 2 columnas, pills, archivos adjuntos, vista responsive |
| Subidas resumables | Completado — ADR-0011 (Tus), panel de uploads multiarchivo y asociacion a media_items |
| CRUD builder generico | Completado — `buildCrudRoutes` elimina boilerplate, entidades unificadas |
| Entidades como taxonomias | Completado — tipos de recurso, idiomas y licencias gestionables desde admin |
| Migracion a React islands | Completado — todas las páginas interactivas migradas (ADR-0013) |
| Design system y rediseño UI | Completado — 25+ componentes, tokens, social UI, badges dinámicos, landing interactiva |
| Datos de demo y seed realista | Completado — 12 usuarios (5 roles), 22 recursos con .elpx, 8 colecciones, social data, admin settings |
| eXeLearning editor | Completado — integración servidor + estáticos |

---

## Fase 2 — Migración y calidad

**Objetivo**: migrar contenidos de Procomún legacy y mejorar la calidad del catálogo.

| Épica | Estado |
|-------|--------|
| Migración desde Procomún (análisis) | En implementación — contexto legacy documentado en `docs/casos/contexto-procomun-legacy/`; ADR-0029 y épica `docs/epics/epic-004-migracion-legacy-procomun/` abiertas para el importador de recursos `.elpx`; piloto sobre 9 ejemplos de `ode-export/` en curso; sigue pendiente obtener PPT del expediente y decisiones de negocio con INTEF sobre alcance/formatos/usuarios históricos |
| Pipeline de ingestión OAI-PMH | No iniciada |
| Flujo de curación y moderación | No iniciada |
| Mejora de relevancia en búsqueda | No iniciada |
| Panel editorial interno | Completado (MVP) — backoffice con sidebar, CSS unificado, CRUD para recursos/colecciones/categorias/usuarios, dialogos nativos, status badges, uploader resumable |

---

## Fase 3 — Descubrimiento avanzado y apertura

**Objetivo**: mejorar el descubrimiento y abrir la plataforma a otros sistemas.

| Épica | Estado |
|-------|--------|
| Colecciones e itinerarios | No iniciada |
| Recomendación de recursos | No iniciada |
| OAI-PMH servidor | No iniciada |
| Exportación bulk del catálogo | No iniciada |
| Analítica de uso y calidad | No iniciada |

---

## Fase 4 — Integraciones y sostenibilidad

**Objetivo**: conectar con el ecosistema educativo y asegurar la operación a largo plazo.

| Épica | Estado |
|-------|--------|
| Integración LTI (Moodle) | No iniciada |
| SSO educativo | Completado |
| Observabilidad y alertas | No iniciada |
| Documentación para operadores (Evo1) | Completado — guías en `docs/operaciones/` |

---

## Actualización de estado — 2026-03-25

### Confirmado en repositorio

- ADR-0001 a ADR-0008 presentes y aceptadas, incluyendo auth y autorización.
- Monorepo operativo con `apps/api`, `apps/frontend`, `apps/cli` y `packages/db`.
- API Hono con separación de rutas públicas (`/api/v1`) y admin (`/api/admin`).
- Better Auth integrado con login por email/password, soporte OIDC configurable y sesiones por cookie.
- RBAC implementado con roles `reader`, `author`, `editor`, `curator`, `admin` (ADR-0016).
- Frontend entonces basado en Astro con páginas `index`, `login` y `dashboard` (después supersedido por ADR-0018).
- CLI para seed y gestión básica de usuarios.
- Cobertura unitaria existente en API/auth/rutas admin.

### Lectura ejecutiva

El proyecto ya superó la fase de mera fundación técnica. La base de plataforma está razonablemente asentada y la primera capacidad transversal relevante completada es autenticación/autorización. Lo que aún no existe es el núcleo del producto: modelo de metadatos mínimo cerrado, recursos persistidos de extremo a extremo, búsqueda/facetas, flujo editorial real e importación.

### Riesgos y ajustes inmediatos

- La regla de validación estricta todavía no se cumple a nivel raíz: `bun test` falla porque Bun intenta ejecutar `e2e/example.spec.ts` como si fuera un test unitario de Playwright.
- La API pública y admin siguen devolviendo respuestas placeholder; hay contratos iniciales pero no lógica de negocio de catálogo.
- El tablero de estado (ahora `status.yaml`, antes `STATUS.md`) estaba desalineado respecto al roadmap y a las ADRs; se corrigió en paralelo para evitar decisiones sobre un estado obsoleto.

### Siguiente tramo recomendado

1. Cerrar la épica de modelo de metadatos mínimo.
2. Convertir recursos y colecciones de placeholders a persistencia real con Drizzle.
3. Separar correctamente tests unitarios y e2e para dejar `bun test` en verde.

## Actualización de trazabilidad — 2026-03-25 (Épica 001 preparada)

- Se formaliza la primera épica real del MVP en `docs/epics/epic-001-mvp-recursos-metadatos-minimos/`.
- Alcance inicial: metadatos mínimos + CRUD real de recursos + validación mínima + base para búsqueda posterior.
- Estado de la épica: **En planificación activa**, con tareas ejecutables por dominios (documentación, backend, BD, frontend, testing).
- Dependencia explícita para próxima iteración: ADR de perfil mínimo de metadatos y ejecución del CRUD persistente.

## Actualización de estado — 2026-03-26

### Confirmado en repositorio

- El catálogo público ya ofrece listado de recursos publicados, ficha de detalle y búsqueda por texto libre.
- La búsqueda pública ya soporta paginación navegable con historial del navegador.
- La búsqueda pública ya soporta filtros básicos por `resourceType`, `language` y `license`.
- El contrato público `/api/v1/resources` acepta `q`, `limit`, `offset`, `resourceType`, `language` y `license`.
- La suite estándar permanece en verde con cobertura por encima del umbral.

### Lectura ejecutiva

El MVP base de catálogo ya no está en fase de mera preparación. La plataforma dispone de CRUD real de recursos, lectura pública de recursos publicados y una primera experiencia de descubrimiento usable para el catálogo. El principal hueco funcional pasa a ser el flujo editorial de recursos y la evolución de búsqueda hacia facetas más ricas.

### Siguiente tramo recomendado

1. Profundizar búsqueda pública con filtros de nivel/materia o facetas contadas.
2. Sustituir placeholders de colecciones públicas por persistencia real.
3. Importación piloto desde CSV.

## Actualización de estado — 2026-03-26 (Flujo editorial)

### Confirmado en repositorio

- Flujo editorial implementado end-to-end: draft → review → published → archived.
- Reglas de transición por rol: author puede enviar a revisión, curator puede aprobar/rechazar/archivar.
- Stepper visual en la página de edición con colores semafóricos (rojo/naranja/verde).
- Campo `createdBy` en recursos, con resolución del nombre del creador vía LEFT JOIN.
- Nombre del creador visible en listado público, dashboard, ficha de recurso y vista de edición.
- Botón "Editar" visible en ficha pública para usuarios autenticados con rol author+.
- Backoffice con sidebar responsive, navegación por rol y CRUD mínimos para recursos, usuarios, categorías y colecciones.
- 159 tests pasando, 91.13% cobertura de líneas.

### Lectura ejecutiva

El flujo editorial de recursos queda completo como experiencia de producto y ya existe una primera base de backoffice para la gestión interna. Los autores pueden crear recursos y enviarlos a revisión; los curadores pueden aprobar, rechazar o archivar. El siguiente foco de Fase 1 es profundizar búsqueda pública y elevar el backoffice desde CRUD mínimo a experiencia editorial más completa.

## Actualización de estado — 2026-03-28 (Bootstrap React islands)

### Confirmado en repositorio

- ADR-0013 deja de ser solo una decisión documental y entra en ejecución real.
- `apps/frontend` integra React como framework de islands en Astro en esa iteración inicial.
- `admin/categorias` se convierte en el primer piloto migrado desde script imperativo a island React.
- Se introduce una base reutilizable para CRUDs hidratados en `src/islands/shared/` y `src/islands/crud/`.
- La estrategia de validación de esa iteración se mantuvo con `bun test` + build del frontend vigente en ese momento.

## Actualización de estado — 2026-03-29 (Rediseño completo + React islands migración completa)

### Confirmado en repositorio

- PR #61: rediseño completo de la interfaz pública y backoffice.
- PR #53: integración de eXeLearning editor (servidor + estáticos).
- Migración completa de React islands: todas las páginas interactivas migradas de vanilla JS a React 19.
- Design system con 25+ componentes React en `src/ui/` (Button, Dialog, Badge, Chip, Tabs, Pagination, ResourceCard, StarRating, CommentList, etc.).
- Tokens de diseño: 40+ tokens de color, tipografía (Plus Jakarta Sans + Inter), escalas de spacing, radios, sombras, modo oscuro.
- Feature islands completos en `src/islands/`: admin (6 sections), auth (login + registro), catalog (búsqueda + detalle), crud (taxonomías, colecciones, recursos, usuarios), dashboard, home (hero + featured), layout (nav pública + admin + preview banner), resources (editor + formulario), social (comentarios, rating, favoritos).
- Componentes compartidos: CrudTable genérico, ConfirmDialog, ModalFrame con trap de foco, AccessibleFeedback.
- Catálogo público completo con React: filtros dinámicos, paginación, grid/list toggle, favoritos optimistas, compartir.
- Formulario de recursos en React con validación inline, errores ARIA, estados de carga.
- Epic 003 en progreso: schema social (ratings, favorites, comments, comment_votes) creado en BD, componentes de UI listos (CommentSectionIsland, RatingIsland, FavoriteIsland), endpoints parcialmente implementados.
- Nuevas páginas: landing (`/`), búsqueda (`/buscar`), registro (`/registro`), perfil (`/perfil`).
- React 19.2.4 + `@astrojs/react` 5.0.2 + `@testing-library/react` 16.3.2 en esa fase previa a la migración completa del shell frontend.

### Lectura ejecutiva

La Fase 1 del MVP está prácticamente completa. La migración a React islands abarca todo el frontend interactivo y se ha creado un design system sólido. El principal gap funcional es completar los endpoints de la API social (ratings, comments, favorites) para conectar los componentes de UI ya construidos. La importación piloto CSV sigue sin iniciar.

### Estado de Fase 1 actualizado

| Épica | Estado |
|-------|--------|
| Modelo de metadatos mínimo | **Completado** |
| Arquitectura base del sistema | **Completado** |
| Autenticación y autorización | **Completado** |
| Flujo editorial de recursos | **Completado** |
| Búsqueda y facetas iniciales | **Completado** |
| API REST pública v1 | **Completado** |
| Frontend público mínimo | **Completado** — rediseñado con design system completo |
| Subidas resumables | **Completado** |
| CRUD builder genérico | **Completado** |
| Entidades como taxonomías | **Completado** |
| Migración a React islands | **Completado** — todas las páginas interactivas migradas |
| Design system (Epic 003) | **Completado** — componentes, tokens, badges dinámicos, landing interactiva |
| Datos de demo y seed | **Completado** — 11 usuarios, 22 recursos .elpx, 8 colecciones, badges, settings |
| Importación piloto desde CSV | **No iniciada** |
| eXeLearning editor | **Completado** — integración servidor + estáticos |

### Siguiente tramo recomendado

1. Implementar endpoints API social: ratings, comments, favorites (conectar componentes de UI existentes).
2. Importación piloto desde CSV.
3. Medir rendimiento: Core Web Vitals, bundle sizes, load testing básico.

## Actualización de estado — 2026-04-10 (Arquitectura frontend y previews)

### Confirmado en repositorio

- El frontend ya no se ejecuta sobre Astro; la implementación actual usa React 19, Vite y React Router.
- La generación de web estática y los previews por PR en GitHub Pages fueron retirados.
- El repositorio ya no contiene `.github/workflows/preview.yml` ni `deploy.yml`; solo permanece `ci.yml`.
- `apps/frontend/package.json` expone `dev`, `build` y `preview` estándar de Vite.
- `apps/frontend/src/App.tsx` y `src/main.tsx` son ahora el entrypoint y el routing principales del frontend.

### Lectura ejecutiva

La documentación histórica de marzo describe correctamente una fase anterior del proyecto, pero ya no representa la arquitectura vigente. La referencia actual para frontend es la combinación React Router + Vite SPA y el desarrollo local con API real, no un preview estático en navegador.

### ADRs relacionadas

- ADR-0017: eliminación de la generación de web estática y preview en GitHub Pages.
- ADR-0018: migración de Astro a React Router + Vite SPA.

## Actualización 2026-03-29 — Ayuda y manual de usuario

- Se añade una ruta pública `/ayuda` con manual de uso estructurado para descubrimiento, publicación, colecciones, FAQ, roles y soporte.
- La navegación pública y el footer ya enlazan a ayuda; el backoffice editorial añade acceso contextual para perfiles `author+`.
- El cambio mejora onboarding, reduce fricción en búsqueda/publicación y deja una base reutilizable de contenido en `apps/frontend/src/lib/help-content.ts`.

## Actualización 2026-03-29 — Colecciones públicas y gestión editorial

- Las colecciones dejan de ser un placeholder en API pública y pasan a exponer listado y detalle con datos reales, conteo de recursos y curador responsable.
- La navegación pública sustituye los enlaces provisionales por una entrada única `Colecciones` y la home enlaza a la nueva experiencia pública.
- El backoffice de colecciones amplía el CRUD con portada, descripción, asociación de recursos existentes y reordenación manual.
- El RBAC de colecciones se endurece: la gestión pasa a `curator` y `admin`; `author` queda fuera del backoffice de colecciones.
- La validación completa del repositorio queda verde con `bun run test` (`337 pass`, `0 fail`, cobertura 91.77%).
- Quedaba entonces una limitación arquitectónica: el detalle público se servía en `/colecciones?slug=...` mientras el frontend seguía en salida estática Astro; esa restricción quedó desfasada tras ADR-0017 y ADR-0018.

## Actualización 2026-03-29 — Datos de demo, badges y landing dinámica

### Datos de demo realistas (issue #64)

- 12 usuarios con 5 roles, bio y contraseñas demo (5 base + 7 adicionales del ámbito educativo).
- 22 recursos educativos con contenido .elpx real generado desde 3 plantillas eXeLearning (temas default, flux, universal).
- 8 colecciones temáticas con recursos asociados y orden editorial.
- 50 valoraciones (3-8 por recurso, medias 3.5-5), 34 favoritos (2-5 por usuario), ~4100 descargas simuladas.
- 15 eventos de actividad para el feed del dashboard.
- Seed idempotente (delete + insert con IDs deterministas).
- Generador de .elpx que usa plantillas reales, modifica content.xml/HTML con contenido educativo y SVG temáticos.
- Fuente única de datos: `seed-data.ts` genera `seed.json` para la versión estática (PGlite en navegador).

### Sistema de badges configurable

- Tabla `platform_settings` para configuración de la plataforma (key-value).
- Badges "Novedad" (días desde creación) y "Destacado" (min ratings + media + favoritos) calculados dinámicamente.
- Umbrales configurables desde el panel admin (sección "Configuración de Badges").
- API pública `GET /config/badges` para que el frontend calcule los badges.
- Badges visibles en catálogo, dashboard y landing.

### Social aggregates en listado de recursos

- `listResources()` devuelve `favoriteCount`, `ratingAvg`, `ratingCount` via subqueries.
- Endpoints del dashboard (`/users/me/dashboard`, `/favorites`, `/ratings`) enriquecidos con elpx preview + social data.
- Contador de favoritos reactivo (se actualiza al marcar/desmarcar).
- Estrella con media de valoración visible en todas las tarjetas.

### Landing page dinámica

- Stats reales desde la API (recursos, docentes, colecciones, novedades).
- Recursos destacados aleatorios con iframe preview del contenido .elpx.
- Colecciones temáticas con carrusel horizontal y gradientes de color.
- CTA con mejor contraste (textos blancos, feature cards legibles).
- Últimas novedades con iframe preview, fecha relativa y título.
- Truco CSS +20px para ocultar scrollbar de iframes cross-origin.

### Mejoras de la versión estática

- `generate-seed-json.ts`: genera seed.json desde seed-data.ts (fuente única).
- `extract-elpx-for-static.ts`: extrae .elpx generados a `public/api/v1/elpx/` para servir previews.
- `build:preview` actualizado para usar la nueva cadena de generación.
- PGlite en navegador: seed robusto con cleanAndSeed, ON CONFLICT, verificación de integridad.

### Refactorizaciones

- Hook compartido `useIframeScale` (4 componentes unificados).
- CSS de catálogo extraído a `catalog.css` (elimina ~1460 líneas duplicadas).
- Helper `buildElpxPreview` + `buildElpxMap` en API (5 call sites unificados).
- `computeResourceBadges` y `DEFAULT_BADGE_CONFIG` en shared-utils.
- `enrichResources` optimizado: 2 batch queries con `inArray` en vez de 2N individuales.
- Tipo `Resource` extendido (rating, favoriteCount, featuredAt, userScore) — eliminados casts unsafe.

### Validación

- 359 tests pasando (3 fallos pre-existentes no relacionados).
- Seed idempotente verificado (re-ejecutable sin errores).

## Actualización 2026-03-31 — Rol editor, limpieza dashboard y mejoras UX (#85)

### Nuevo rol editor (ADR-0016)

- Rol `editor` (nivel 2) entre author (1) y curator (3) con publicación directa (`draft → published`) sin cola de revisión.
- Jerarquía de roles renumerada a enteros: reader=0, author=1, editor=2, curator=3, admin=4.
- Permisos RBAC: mismas capacidades que author (create/read/update), sin curación ni moderación.
- Rol mínimo para cuentas nuevas cambiado de `reader` a `author` (`defaultRole`, schema DB, CLI, frontend).
- `reader` se mantiene como nivel de acceso público/no autenticado.
- 12 usuarios demo (añadido `demo-editor`), nombres barajados del equipo real.
- Tests: 350 pass, 0 fail (11 tests nuevos para editor).

### Limpieza dashboard antiguo

- Eliminados: `dashboard.astro`, `DashboardIsland.tsx`, `AdminLayout.astro`, `AdminNavIsland.tsx`, `backoffice-nav.ts` y páginas de listado antiguas bajo `/admin/`.
- El panel de administración (`/admin`) ahora es solo para curator+ (SPA con `AdminPageIsland` + `AdminSidebar`).
- Author/editor trabajan desde `/perfil` (dashboard personal con recursos, favoritos, actividad).
- `editar.astro` y `nuevo.astro` migrados de `AdminLayout` a `PublicLayout`.

### Mejoras UX

- Badges de estado editorial ("Borrador", "En revisión") en perfil de usuario con colores propios.
- Botón "Editar" en detalle de recurso solo visible si eres propietario o curator+.
- Botón "Publicar directamente" para editores en todas las páginas de edición.
- Fix beforeunload en editor eXeLearning: iframe se reemplaza con clon limpio al cerrar.
- Fallback `.env.example` cuando no existe `.env` (SSO funciona sin configuración manual).
- `hasMinRole()` extraído a `shared-utils.ts` como utilidad compartida.

### Validación

- 350 tests pasando, 0 fallos.
- Seed idempotente verificado con IDs actualizados.

## Actualizacion 2026-05-22 — Priorizacion de Fase 2 desde matriz funcional

### Fuente de priorizacion

Se crea `docs/casos/matriz-decision-funcional-procomun/README.md` cruzando:

- inventario funcional de Procomun actual,
- inventario funcional de `procomun-ng`,
- contexto legacy y requisitos funcionales ya documentados,
- estado previo del roadmap.

La matriz usa cinco decisiones por funcionalidad: `mantener como esta`, `mejorar antes de migrar`, `implementar porque falta`, `descartar o sustituir` y `validar con usuario/INTEF`.

### Lectura ejecutiva para Fase 2

Fase 2 debe tratar la migracion como una iniciativa de calidad de producto, no solo como carga de datos. Antes de migrar en volumen, el roadmap debe cerrar busqueda/facetas, metadatos completos, estrategia ETL, decision de Banco Multimedia, experiencia de itinerarios y decision sobre comunidades/articulos.

### Orden recomendado de epicas Fase 2

| Orden | Epica recomendada | Prioridad | Motivo |
|-------|-------------------|-----------|--------|
| 1 | Busqueda, facetas y relevancia Fase 2 | P0 | Sin materia, nivel/contexto, etiquetas, conteos, ordenacion real y relevancia documentada, el catalogo migrado sera dificil de descubrir. |
| 2 | Perfil de metadatos y calidad editorial | P0 | La migracion necesita mapeo legacy -> `procomun-ng`, obligatoriedad por tipo, validacion editorial y taxonomias gobernables. |
| 3 | Migracion legacy Procomun | P0 | Falta ETL real, importacion piloto, deduplicacion, trazabilidad, rollback y decision sobre usuarios/autoria historica. |
| 4 | Banco Multimedia | P0/P1 | Falta decidir modelo de producto y crear MVP para media reutilizable, busqueda, licencia, descarga, contribucion y moderacion. |
| 5 | Itinerarios y colecciones didacticas | P1 | Las colecciones actuales son buena base, pero no cubren itinerarios legacy con narrativa, pasos, clonacion y posible inclusion de articulos. |
| 6 | Comunidades, articulos y comunicacion editorial | P1/P2 | Requieren decision INTEF: implementar, sustituir por CMS/canales externos/curacion editorial o excluir del alcance. |
| 7 | Moderacion y backoffice editorial avanzado | P1 | El backoffice MVP debe evolucionar a colas, motivos de rechazo, informes, revision de calidad y acciones masivas. |
| 8 | Interoperabilidad y apertura | P2 | OAI-PMH, exportacion bulk y documentacion API deben llegar tras cerrar metadatos y migracion base. |

### Decisiones pendientes con usuario/INTEF

- Migracion completa frente a migracion selectiva por calidad, licencia, uso o valor curricular.
- Tratamiento de usuarios historicos: cuentas activas, autores preservados, atribucion anonima o remapeo institucional.
- Banco Multimedia como producto independiente o como vista especializada de `media_items`.
- Articulos dentro de `procomun-ng`, en CMS externo o fuera del alcance.
- Comunidades como red social docente o sustitucion por colecciones, taxonomias y curacion editorial.
- Formatos legacy obligatorios: SCORM 1.2, SCORM 2004, IMS, ePUB, HTML y/o `.elpx`.
- App movil nativa frente a web responsive/PWA.

### Ajuste recomendado del estado de Fase 2

La tabla historica de Fase 2 sigue siendo valida como fotografia previa, pero la nueva matriz aconseja tratar como bloqueantes inmediatos:

1. `Busqueda y facetas completas`.
2. `Metadatos completos y calidad editorial`.
3. `Migracion legacy con ETL trazable`.
4. `Decision y MVP de Banco Multimedia`.
5. `Itinerarios sobre colecciones ordenadas`.
6. `Decision sobre comunidades y articulos`.

## Actualización 2026-07-16 — Evaluación de estrategia de modernización (ADR-0030 propuesta)

Se completa el caso documental `docs/casos/evaluacion-reescritura-plataforma/`, que evalúa con línea base medida (commit `eea2fe7d`) si la plataforma debe refactorizarse, modularizarse, sustituir tecnologías, reescribirse incrementalmente o reescribirse por completo.

Resultado: **ADR-0030 en estado Propuesto** — «Rechazar la reescritura completa y ejecutar simplificación incremental» (programa por lotes 0–5: reparar puertas de calidad, typecheck a cero, suite de caracterización, fuente única de esquema, puertos y límites, división de módulos mixtos), con plan piloto documental sobre la vertical Colecciones y prompt de ejecución posterior.

Hallazgos que condicionan el roadmap: el lint y el format-check son no-op (paquete `biome` equivocado), el typecheck de CI ignora 635 errores, la suite de integración está vacía, los 17 E2E saltados cubren el flujo editorial de escritura, y el esquema de datos carece de migraciones aplicadas y de camino de upgrade — este último punto es bloqueante a resolver **antes** de la épica de migración legacy (~79k ODEs). No se modifica código en esta tarea; la implementación queda condicionada a la aceptación humana de la ADR-0030.

## Actualización 2026-08-06 — Recursos relacionados (issue #72 / ADR-0036)

Se entrega la fase 1+2 del sistema de recomendación en ficha de recurso:

- Endpoint público `GET /api/v1/resources/:slug/related`
- Ranking multi-señal en PostgreSQL (materias, niveles, tipo, keywords, autor, colecciones, FTS)
- UI «También te puede interesar» + «Más del mismo autor»
- Collaborative filtering / «Recomendados para ti» queda diferido (fase 3 de ADR-0036)

Trazabilidad: `docs/epics/epic-003/features/feature-recomendacion-recursos-relacionados/`, ADR-0036.
