# ADR-0034 Sistema de etiquetado atomizado (tags)

* Estado: Aceptado
* Fecha: 2026-08-06
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica], [@.agents/skills/metadatos-y-curacion], [@.agents/skills/backend-api-servicios], [@.agents/skills/busqueda-y-descubrimiento]
* Issue: #76 (Evo8 / CE01698/2023)

## Contexto y Problema

Los recursos usan `keywords` como **texto libre** (comas). Eso genera duplicados (`matemáticas` / `Matematicas` / `mates`), impide facetas fiables, autocompletado y curación editorial. El pliego y el mapa de capacidades piden **atomizar el tagging**.

ADR-0009 deja `keywords` como opcional libre; este ADR evoluciona ese campo hacia un modelo relacional sin romper la API de lectura durante la transición.

## Opciones Consideradas

### A — Mantener keywords texto libre
* Pros: cero migración, simple
* Contras: no resuelve duplicados ni navegación por etiqueta; no cumple Evo8

### B — Reutilizar `taxonomies` con `type = "tag"`
* Pros: tabla ya existente (jerárquica)
* Contras: tags no deben ser jerárquicos como categorías; `usageCount`, sinónimos y pivote con recursos no encajan bien; mezcla vocabularios controlados (materias) con etiquetas de autor

### C — Servicio externo de taxonomías / search-only tags
* Pros: facetas potentes
* Contras: lock-in, operación extra, ADR-0005 apuesta por PostgreSQL nativo

### D — Tablas dedicadas `tags` + `resource_tags` (+ sinónimos) — estilo Ghost/WordPress tags / Drupal terms flat
* Pros: modelo claro, índices en slug/label, merge y sinónimos, dual-write con `keywords`
* Contras: migración y dual-write temporal; UI de curación a completar

**Referencias de producto:** WordPress (tags planos vs categorías jerárquicas), Ghost (`tags` + pivote), Drupal (vocabulary terms, aquí separado de taxonomies jerárquicas), CKAN (free tags + vocabularies).

**ORM:** Drizzle junction table con `primaryKey` compuesto e índices por FK (docs drizzle-orm many-to-many).

## Decisión

Se adopta la **opción D**:

| Pieza | Diseño |
|-------|--------|
| `tags` | `id`, `slug` unique, `label`, `description`, `usageCount`, `canonicalTagId` (sinónimo → canónico), timestamps |
| `resource_tags` | PK (`resourceId`, `tagId`), `createdAt` |
| Normalización | slugify NFD + minúsculas (mismo criterio que slugs de recursos); parseo de keywords por `,;`/`\|` |
| Duplicados | `ensureTag` reutiliza por slug; merge editorial reasigna enlaces y marca sinónimo |
| Transición | `keywords` se mantiene **deprecated** y se sincroniza al escribir tags; `migrateKeywordsToTags` para datos legacy |
| FTS | los labels siguen alimentando `keywords` y por tanto el `tsvector` existente hasta una iteración FTS dedicada |

No se introduce librería externa de tagging: lógica pura TypeScript + PostgreSQL/PGlite.

## Consecuencias

### Positivas
* Autocompletado y popular tags con consultas indexadas
* Merge y detección de similares (Levenshtein) para curación
* Navegación `/api/v1/tags/:slug` y listado de recursos por tag
* Cumple el núcleo de #76 sin SaaS

### Negativas / Riesgos
* UI pública de nube de tags y faceta de búsqueda completa quedan como siguientes entregas
* `usageCount` denormalizado debe mantenerse en attach/detach/merge
* i18n de labels: una etiqueta = un idioma de origen (multilingüe aplazado)

## Notas de Implementación

1. Dominio: `packages/db/src/tags/normalize.ts`
2. Schema + migración `0005_atomized_tags` + `setup.ts`
3. Repositorio: `packages/db/src/repository/tags.ts`
4. API pública: `/api/v1/tags`, `/popular`, `/:slug`, `/:slug/resources`
5. API admin: `/api/admin/tags` (list, merge, migrate-keywords, CRUD, resource attach)
6. Dual-write en `createResource` / `updateResource` cuando hay `keywords`
7. Siguiente: faceta en catálogo, página frontend `/tags/:slug`, panel admin de merges en UI

## Criterios de revisión

* Si el volumen de tags supera el rendimiento de `LIKE` en label, valorar `pg_trgm`
* Si se exige multilingüe, añadir tabla `tag_labels(locale, label)` sin romper slug canónico
