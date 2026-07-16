# Hallazgos de arqueología de arquitectura

* Fecha: 2026-07-16
* Commit analizado: `eea2fe7d` (`main`)
* Método: lectura de los 33 archivos ADR, `decision-log.yaml`, `docs/producto/*` y contraste con el código de `apps/` y `packages/` (solo lectura).
* Separación de niveles: **[H] hecho verificado en archivo/código · [I] inferencia · [?] no verificado**.

## 1. Estado del corpus de decisiones

[H] En el commit analizado (`eea2fe7d`) existen **32 archivos ADR** en `docs/negocio/decisiones/` para **28 entradas** en `decision-log.yaml` (numeración 0001–0028 con el desdoble 0015a/0015b y sin entrada para 0025). Esta evaluación añade la ADR-0030 a ambos lados, dejando 33 archivos / 29 entradas; el delta de 4 archivos sin indexar se mantiene igual.

[H] **Colisiones de numeración** (tres pares además del 0015a/0015b ya regularizado):

| Número | Archivo indexado en `decision-log.yaml` | Archivo NO indexado |
| --- | --- | --- |
| 0023 | `0023-evaluacion-migracion-vite-a-bun-bundler.md` (Rechazado) | `0023-generacion-feeds-atom-rss.md` (Aceptado, **implementado**: `apps/api/src/feeds/`, ruta `/feeds`) |
| 0024 | `0024-exportacion-elpx-formatos-estandar.md` (Aceptado) | `0024-api-publicacion-tokens.md` (Aceptado, **implementado**: `packages/db/src/schema/api-tokens.ts`, `apps/api/src/auth/token-auth.ts`, `/api/v1/publish/*`) |
| 0026 | `0026-apertura-segura-elpx.md` (Aceptado) | `0026-extraccion-texto-busqueda-fts-postgresql.md` (Propuesto, **implementado**) |

[H] `0025-jsonb-para-metadatos-semiestructurados.md` existe (y `status.yaml` lo referencia en T-2026-06-24-002) pero **tampoco figura en `decision-log.yaml`**. En total, cuatro archivos ADR quedan fuera del índice: 0023-feeds, 0024-api-tokens, 0025-jsonb y 0026-FTS — lo que cuadra con la aritmética 32 archivos ↔ 28 entradas del commit analizado.

[H] **Estados desincronizados índice↔archivo** (el índice marca Supersedido; el archivo sigue diciendo «Aceptado»): ADR-0004, ADR-0010, ADR-0012, ADR-0013.

[H] **ADR-0026-FTS figura «Propuesto» pero está implementada**: módulo completo `apps/api/src/fts/` (extract, search, worker, rutas admin) y columnas `extracted_text`, `search_vector tsvector`, `extraction_status` en `packages/db/src/schema/resources.ts`.

[H] **Fechas inconsistentes** en ≥10 ADRs entre índice y archivo; dos archivos con año erróneo 2024 (`0002`, `0015-cumplimiento-ens.md`).

[I] El corpus ADR es rico y disciplinado en contenido, pero el mecanismo de numeración/indexación manual no escala con trabajo paralelo de agentes: las colisiones coinciden con periodos de ramas simultáneas.

## 2. Divergencias documentación ↔ código

| Divergencia | Evidencia | Gravedad |
| --- | --- | --- |
| [H] `modelo-de-dominio.md` define 4 roles (`admin/curator/author/reader`); el código tiene 5 (falta `editor`, ADR-0016) | `docs/producto/modelo-de-dominio.md:143` vs `packages/db/src/validation.ts` | Media |
| [H] `modelo-de-dominio.md` solo modela Resource, MediaItem, Collection, User; el esquema real tiene 21 tablas (social, reports, settings, api-tokens, taxonomies, uploads, elpx) | `packages/db/src/schema/` | Media |
| [H] `arquitectura.md` omite superficies API reales: `/api/v1/tokens`, `/api/v1/publish/*`, `/api/dev`, `/api/uploads`, `/feeds` | `apps/api/src/app/routes.ts:26-36` | Baja |
| [H] Capacidades implementadas sin ADR dedicada: social (ratings/favoritos/actividad), reports/moderación, platform_settings/badges | `packages/db/src/schema/social.ts`, `reports.ts`, `settings.ts` | Baja |
| [H] Comentario de `api-client.ts:3` menciona `PreviewApiClient`, eliminado por ADR-0017 | `apps/frontend/src/lib/api-client.ts` | Cosmética |
| [H] Deriva de versiones citadas en ADRs (PGlite 0.4.5→0.5.4 real; feed 5.2.1→^6.0.0) | ADR-0025, ADR-0023-feeds | Cosmética |

## 3. Historia de migraciones ya ejecutadas (precedente interno)

Eje frontend, documentado en ADRs y `status.yaml`:

1. [H] ADR-0004 (2026-03-25): **Astro** con arquitectura de islas.
2. [H] ADR-0013 (2026-03-28): **React como framework de islas** dentro de Astro; motivación registrada: ~3 200 LOC de JS vanilla imperativo inmantenible.
3. [H] ADR-0017 (2026-04-10): eliminación del preview estático/GitHub Pages; coste registrado ~1 500 líneas eliminadas (`PreviewApiClient` ~1 000 líneas, workflows, condicionales `PREVIEW_*`).
4. [H] ADR-0018 (2026-04-10, mismo día): **Astro → React Router + Vite SPA**; 26 páginas `.astro` y 2 layouts eliminados; los 67 componentes island React sobrevivieron intactos (0 imports de `astro`).
5. [H] ADR-0023-vite (2026-05-26): migración Vite→Bun bundler evaluada y **rechazada** (React Fast Refresh sin soporte en Bun, plugin Paraglide, y Vite 8/Rolldown iguala la velocidad).

Eje datos/preview: SQLite sql.js (ADR-0002) → PGlite (ADR-0010, eliminó ~250 líneas de esquemas duplicados) → IndexedDB preview (ADR-0012) → todo el preview eliminado (ADR-0017). PGlite cambió de propósito: de «preview en navegador» a «desarrollo local por defecto».

**Lecciones registradas en el propio repositorio** [H]:

* El desacoplamiento deliberado islands↔Astro (cero imports del framework en los componentes) hizo barata la migración de ADR-0018 — está registrado en ADR-0017/0018.
* La estrategia de dos ADRs el mismo día (primero retirar el preview manteniendo Astro, después retirar Astro) fue una sustitución **por etapas**, no un big bang.
* Existe un patrón editorial estable: se elimina infraestructura cuando «añade complejidad sin valor proporcional» (ADR-0017) y se rechaza sustituir tecnología solo por uniformidad (ADR-0023-vite).

[I] Consecuencia para esta evaluación: el equipo ya ejecutó con éxito la única «reescritura» que tenía justificación (la capa de páginas), la hizo incremental, barata y sin regresión registrada, y rechazó explícitamente la última propuesta de sustitución tecnológica sin beneficio demostrado. El precedente interno favorece los seams y la sustitución selectiva frente al big bang.

## 4. Arquitectura vigente (verificada)

* [H] Monorepo Bun workspaces: `apps/api` (Hono 4.12.30 + Better Auth 1.6.23), `apps/frontend` (React 19 + Vite 8 + React Router 7), `apps/cli` (seed/gestión), `packages/db` (Drizzle 0.45.2 + PGlite 0.5.4).
* [H] Composición API: `apps/api/src/app.ts` (13 líneas) + `app/routes.ts` (montaje) + `routes/crud-builder.ts` (fábrica CRUD genérica de 176 líneas) + fachada de repositorios por dominio en `packages/db/src/repository/`.
* [H] Better Auth se monta como handler fetch-estándar (`auth.handler(c.req.raw)`), **no** depende de Hono.
* [H] Existe un **segundo sistema de autenticación** paralelo: Bearer tokens propios con rate-limiter in-memory (`apps/api/src/auth/token-auth.ts`) para `/api/v1/publish/*`.
* [H] **Triple definición de esquema de datos**: `packages/db/src/setup.ts` (SQL a mano, la única fuente aplicada), `packages/db/migrations/*.sql` (drizzle-kit, muertas: journal desincronizado, nadie ejecuta `drizzle-kit migrate`), `packages/db/src/schema/*.ts` (tipos Drizzle). Detalle en `technology-assessment.md` y en el informe de datos.
* [H] Dos drivers PostgreSQL: `drizzle-orm/bun-sql` (API con `DATABASE_URL`) y paquete npm `postgres` (CLI/seed).
* [H] Despliegue canónico: servicio único API+SPA (ADR-0021), Docker `oven/bun` + `postgres:17-alpine` (ADR-0015b).

## 5. Restricciones vigentes que cualquier estrategia debe preservar

1. ENS Categoría MEDIA (ADR-0015a, RD 311/2022): auditoría de accesos, trazabilidad, TLS/cifrado — restricción legal.
2. TypeScript strict + Bun (ADR-0001) y `bun test` (regla 14 de AGENTS.md).
3. PostgreSQL como único dialecto; PGlite = mismo motor en dev (ADR-0005/0006/0010).
4. i18n 5 idiomas (es/en/ca/gl/eu) con Paraglide (ADR-0014), URLs localizadas.
5. Uploads tus + `upload_sessions` + URLs directas y reutilizables por `media_item` (ADR-0011/0020).
6. Seguridad .elpx: extracción endurecida + origen opaco + embeds promote-to-parent (ADR-0026/0027). Invariante: el JS de autor nunca obtiene el origen autenticado.
7. RBAC 5 roles jerárquicos (ADR-0008/0016) con separación `/api/v1` público vs `/api/admin`.
8. Better Auth es dueño del esquema `user/session/account/verification` (ADR-0007).
9. Servicio canónico unificado API+frontend (ADR-0021).
10. Perfil mínimo de metadatos de 5 campos y estados editoriales (ADR-0009).
11. Vite como bundler mientras persistan los bloqueos registrados (ADR-0018 + ADR-0023-vite rechazada).
12. DESIGN.md + `design-tokens.css` como contrato de diseño (ADR-0022).
13. Tracking YAML map-keyed inmutable (ADR-0019).

## 6. Acciones documentales que esta evaluación NO ejecuta

Las siguientes correcciones se identifican pero se dejan como tareas propuestas (tocarían decisiones vigentes y exceden el alcance de este caso): renumerar/regularizar los ADR duplicados 0023/0024/0026, pasar ADR-0026-FTS a «Aceptado», sincronizar el estado «Supersedido» en los archivos 0004/0010/0012/0013, corregir los años 2024 erróneos y actualizar `modelo-de-dominio.md`. Se listan como consecuencia en la ADR-0030 propuesta.
