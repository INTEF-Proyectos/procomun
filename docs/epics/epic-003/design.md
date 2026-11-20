# Epic-003: Public Interface Redesign

## Stitch Screens Used

| Screen | Stitch ID | Used For |
|--------|-----------|----------|
| Landing Page Procomún Rediseño | 43fe7396 | Home page: hero, stats, featured resources, collections, CTA |
| Resultados de Búsqueda | 275f4a61 | Search results: filter sidebar, result cards, pagination |
| Ficha de Recurso Educativo | 60509d18 | Resource detail: tabs, ratings, comments, metadata |
| Panel de Gestión - Backoffice | f9a42c01 | Dashboard metrics, sidebar navigation patterns |
| Gestión de Recursos - Backoffice | bb79619f | Resource management table, status badges |

## Components Created

### Design System (`apps/frontend/src/ui/`) — 25 components

**Core inputs:** Button, IconButton, Input, SearchBar, Select, Checkbox
**Display:** Badge, Chip, Skeleton, EmptyState
**Navigation:** Breadcrumb, Tabs, Pagination
**Layout:** PageHeader, Drawer, Dialog
**Resource:** ResourceCard, ResourceGrid, FilterPanel, MetadataList
**Social:** StarRating, RatingSummary, FavoriteButton, CommentItem, CommentList

### Feature Islands

**Home:** HeroIsland, FeaturedResourcesIsland
**Social:** CommentSectionIsland, RatingIsland, FavoriteIsland
**Auth:** RegisterIsland (new)
**Dashboard:** PublicDashboardIsland (new)

### Pages

| Page | Path | Status |
|------|------|--------|
| Landing | `/` | New (redesigned from catalog) |
| Search | `/buscar` | New (dedicated search page) |
| Resource detail | `/recurso` | Enhanced with social tabs |
| Register | `/registro` | New |
| User dashboard | `/perfil` | New |
| Login | `/login` | Existing (restyled via tokens) |

## Design System Foundation

### Tokens (`apps/frontend/src/styles/design-tokens.css`)
- 40+ named color tokens from Stitch (light + dark mode)
- Typography: Plus Jakarta Sans (display) + Inter (body)
- Spacing scale: 0.25rem–6rem
- Border radius: xs–full
- Ambient shadows (large, diffused per Stitch spec)
- Glass effect tokens for header
- Z-index scale

### Fonts
- Plus Jakarta Sans 600/700/800 (self-hosted woff2)
- Inter 400/500/600 (self-hosted woff2)
- Material Symbols Outlined (CDN)

## Assumptions and Inferences

1. **Login/Register screens** were not present in Stitch — derived from the existing LoginIsland pattern with design system styling.
2. **User dashboard** was not in Stitch — derived from the backoffice dashboard pattern but simplified for public users.
3. **"Útil" engagement signal** was chosen over upvote/downvote as it appears in the Stitch resource detail screen and fits an educational platform (signals pedagogical value rather than social approval).
4. **Dark mode** tokens were inferred using Material Design 3 dark theme generation rules from the light palette.
5. **Collections/Itineraries** pages were documented in types but not fully implemented as pages — the type infrastructure supports future implementation.
6. **Resource create/edit form** enhancement was deferred — the existing ResourceFormIsland is functional and will be restyled incrementally.

## Accessibility Decisions

- Skip-to-content link on all public pages
- ARIA landmarks: `<header>`, `<main id="main-content">`, `<footer role="contentinfo">`
- All interactive components have `:focus-visible` styles (2px solid primary, 2px offset)
- Tabs: keyboard arrow navigation, `aria-selected`, `role="tabpanel"`
- StarRating: `role="radiogroup"` with keyboard arrow key support
- FavoriteButton: `aria-pressed` toggle
- CommentItem: `aria-label` per comment
- Drawer/Dialog: focus trap, Escape to close, return focus on close
- Color contrast: all text/surface combinations meet WCAG AA 4.5:1
- No 1px borders for visual separation (per Stitch spec) — uses tonal surface layering
- Minimum touch targets: 44x44px for all interactive elements
- `aria-live="polite"` on search results and loading states

## Domain Model Overview

### Types Created (`apps/frontend/src/lib/types/`)

| File | Types |
|------|-------|
| social.ts | Comment, CommentAuthor, CommentThread, RatingSummary, UserRating, Favorite, CommentVote, ModerationStatus, VoteType |
| search.ts | SearchQuery, SearchFilters, SearchResult, FacetGroup, FacetItem, SearchSort, DateRangePreset |
| resource-extended.ts | ResourceSummary, ResourceDetail, ResourceMetadata, ResourceLicense |
| user-extended.ts | PublicUserProfile, DashboardSummary, ActivityItem |
| collection-extended.ts | Collection, Itinerary, ItineraryStep, Tag, EducationalContext, SubjectArea |
| editorial.ts | EditorialStatus, EditorialStatusInfo, EDITORIAL_STATUS_MAP |

### Database Schema Added (`packages/db/src/schema/social.ts`)

| Table | Purpose |
|-------|---------|
| ratings | User ratings (1-5) per resource, unique per user |
| favorites | User bookmarks, unique per user per resource |
| comments | Threaded comments with moderation status |
| comment_votes | "Useful" engagement signal on comments |

## Next Backend Endpoints Needed

```
GET    /api/v1/resources/:slug/ratings     → aggregate rating summary
POST   /api/v1/resources/:slug/ratings     → create/update user rating
GET    /api/v1/resources/:slug/comments    → paginated threaded comments
POST   /api/v1/resources/:slug/comments    → create comment
PATCH  /api/v1/comments/:id               → edit own comment
DELETE /api/v1/comments/:id               → soft-delete
POST   /api/v1/comments/:id/vote          → toggle "useful"
POST   /api/v1/resources/:slug/favorite    → toggle favorite
GET    /api/v1/users/me/favorites          → user's saved resources
GET    /api/v1/users/me/dashboard          → dashboard summary
```

## Actualizacion 2026-04-24: contrato DESIGN.md

Se anade la feature `feature-design-md-contrato-diseno` para formalizar el sistema de diseno como contrato raiz consumible por agentes IA y herramientas compatibles con la especificacion `DESIGN.md` de Google Labs/Stitch.

La decision queda registrada en ADR-0022. En esta iteracion `DESIGN.md` es un artefacto derivado y validado desde el sistema existente, no la fuente primaria de estilos. La fuente operativa sigue siendo `apps/frontend/src/styles/design-tokens.css` y los componentes de `apps/frontend/src/ui/`.

Validacion asociada:

* `bun run design:lint`
* `bun test`

## File Tree of New/Modified Files

```
apps/frontend/src/
├── styles/
│   ├── design-tokens.css          [NEW] Design system tokens
│   ├── reset.css                  [NEW] Minimal CSS reset
│   └── utilities.css              [NEW] Utility classes
├── ui/                            [NEW] 25 component files + 25 CSS files + index.ts
│   ├── Button.tsx + .css
│   ├── IconButton.tsx + .css
│   ├── Input.tsx + .css
│   ├── SearchBar.tsx + .css
│   ├── Select.tsx + .css
│   ├── Checkbox.tsx + .css
│   ├── Chip.tsx + .css
│   ├── Badge.tsx + .css
│   ├── Tabs.tsx + .css
│   ├── Drawer.tsx + .css
│   ├── Dialog.tsx + .css
│   ├── Skeleton.tsx + .css
│   ├── EmptyState.tsx + .css
│   ├── Breadcrumb.tsx + .css
│   ├── PageHeader.tsx + .css
│   ├── Pagination.tsx + .css
│   ├── ResourceCard.tsx + .css
│   ├── ResourceGrid.tsx + .css
│   ├── FilterPanel.tsx + .css
│   ├── MetadataList.tsx + .css
│   ├── StarRating.tsx + .css
│   ├── RatingSummary.tsx + .css
│   ├── FavoriteButton.tsx + .css
│   ├── CommentItem.tsx + .css
│   ├── CommentList.tsx + .css
│   └── index.ts
├── islands/
│   ├── home/                      [NEW]
│   │   ├── HeroIsland.tsx + .css
│   │   └── FeaturedResourcesIsland.tsx
│   ├── social/                    [NEW]
│   │   ├── CommentSectionIsland.tsx
│   │   ├── RatingIsland.tsx + .css
│   │   └── FavoriteIsland.tsx
│   ├── auth/
│   │   └── RegisterIsland.tsx + .css  [NEW]
│   ├── dashboard/
│   │   └── PublicDashboardIsland.tsx + .css  [NEW]
│   └── catalog/
│       └── ResourceDetailIsland.tsx   [MODIFIED] Added tabs + social
├── lib/
│   ├── types/                     [NEW]
│   │   ├── social.ts
│   │   ├── search.ts
│   │   ├── resource-extended.ts
│   │   ├── user-extended.ts
│   │   ├── collection-extended.ts
│   │   ├── editorial.ts
│   │   └── index.ts
│   ├── mock/                      [NEW]
│   │   ├── mock-data.ts
│   │   └── mock-social-service.ts
│   └── api-client.ts             [MODIFIED] Social method signatures
├── layouts/
│   ├── Base.astro                 [MODIFIED] Tokens, fonts, landmarks
│   └── PublicLayout.astro         [NEW] Public pages layout
├── pages/
│   ├── index.astro                [MODIFIED] Full landing page redesign
│   ├── buscar.astro               [NEW] Dedicated search results
│   ├── recurso.astro              [MODIFIED] Design system + social
│   ├── registro.astro             [NEW] Registration page
│   └── perfil.astro               [NEW] User dashboard
└── public/fonts/                  [NEW] 6 woff2 font files

packages/db/src/schema/
├── social.ts                      [NEW] ratings, favorites, comments, comment_votes
└── index.ts                       [MODIFIED] Added social export

apps/api/src/routes/
└── social.ts                      [NEW] Social API endpoints
```

## Seguimiento 2026-11-03 — avatar de Gravatar (#514)

Nadie veía su foto de Gravatar en el menú ni en `/perfil`; todos tenían la silueta `d=mp`.

- Causa: `gravatarUrl` (`apps/frontend/src/lib/shared-utils.ts`) resumía el correo con un hash propio de 64 bits. Gravatar solo reconoce el SHA-256 o el MD5 del correo recortado y en minúsculas (<https://docs.gravatar.com/api/avatars/hash/>), y con cualquier otro valor sirve la imagen por defecto. El perfil, además, resumía `${id}@procomun.es` en lugar del correo de la sesión.
- La CSP no intervenía: las páginas de la aplicación no envían CSP, `Referrer-Policy` ni COEP (`nginx.conf` solo añade `X-Frame-Options` y `nosniff`), y Gravatar sirve `image/jpeg` sin `Cross-Origin-Resource-Policy`.
- [x] `apps/frontend/src/lib/gravatar.ts`: SHA-256 con `crypto.subtle` del correo normalizado, y URL `https://www.gravatar.com/avatar/<hash>?s=<tamaño>&d=mp`. Sustituye al helper de `shared-utils.ts`.
- [x] El hash se calcula una vez, al cargar la sesión: `toNavUser` en `PublicNavIsland` (`s=80`) y `profileAvatarUrl` en `PublicDashboardIsland` (`s=192`, para el avatar de 96 px), que lo guarda en `PublicUserProfile.avatarUrl`. Solo se resume el correo del propio usuario; no se exponen hashes de otros.
- [x] `apps/frontend/src/ui/UserAvatar.tsx`: muestra la foto y, si no hay URL (sin `crypto.subtle`, es decir, sin HTTPS) o la imagen no carga, la inicial del nombre. Sustituye al `onError` que manipulaba el DOM en el menú.
- [x] Las demás vistas con avatar (ficha, tarjetas, catálogo, colecciones, backoffice) muestran iniciales o un icono y no piden imagen a Gravatar.
- [x] Tests rojo → verde: `gravatar.unit.test.ts` (ejemplo de la documentación de Gravatar, SHA-256 calculado con `Bun.CryptoHasher`, normalización, forma de la URL y casos sin hash), `UserAvatar.unit.test.tsx`, `LayoutIslands.unit.test.tsx` y `PublicDashboardIsland.unit.test.tsx`.

## Riesgos abiertos 2026-11-03

- No hay foto de perfil propia en `main`: `user.image` no se usa para representar al usuario (ADR-0037). Cuando exista `user_profile.image`, irá en `avatarUrl` antes que Gravatar.
- Cada carga de la página envía a Gravatar el hash del correo y la IP del usuario. Si se mantiene la integración se decide en #504.
- Falta comprobar a mano la carga de una foto real con una cuenta de prueba que tenga Gravatar.

## Seguimiento 2026-11-16 — «Mis recursos» completo (#530)

La pestaña «Mis recursos» de `/perfil` solo enseñaba los 5 últimos recursos (`getUserDashboardSummary`, `.limit(5)`), sin paginación ni filtros, y el contador sumaba solo publicados y borradores. Sale de la comparativa de #494.

- [x] API: `GET /api/v1/users/me/resources` (sesión obligatoria). Todos los recursos propios no eliminados, en cualquier estado, ordenados por última edición. Admite `status` (`draft`, `review`, `published`, `archived`; otro valor da 400), `q`, `resourceType`, `tag`, `educationalCategory`, `educationalOption`, `knowledgeAreas`, `professionalFamilies`, `limit` y `offset`, igual que el buscador público. Devuelve `{ data, total, limit, offset, statusCounts }`.
- [x] `statusCounts` cuenta por estado con los mismos filtros que la lista, sin el estado: «Todos» es la suma de los cuatro y cada contador coincide con lo que se ve al elegir ese estado. Sale de `countResourcesByStatus`, que comparte condiciones con `listResources` (`packages/db/src/repository/resources.ts`).
- [x] `GET /api/v1/users/me/dashboard` añade `reviewCount`, `archivedCount` y `resourceCount`, y deja de devolver `recentResources`. La cabecera del perfil enseña también los recursos en revisión, y los archivados si hay alguno; la pestaña cuenta todos.
- [x] Interfaz (`MyResourcesTab.tsx`): buscador, filtro de estado con radios y sus contadores, «Más filtros» (tipo, etapa y ciclo, área y familia, etiqueta) con «Limpiar filtros», paginación de 12 y, en cada tarjeta propia, «Editar» y «Eliminar» siempre visibles. Eliminar abre el `ConfirmDialog` accesible de Administrar, nunca `window.confirm`; al borrar se anuncia en una región de estado, el foco pasa a ese aviso y se vuelven a pedir los contadores del perfil. Textos en los cinco idiomas.
- [x] Editar y eliminar solo aparecen si `canManageResource` lo permite, la misma regla que aplica `DELETE /api/admin/resources/:id`.
- [x] `ui/Pagination.tsx` deja los textos fijos en castellano y usa Paraglide.
- [x] Tests rojo → verde: `my-resources-service.unit.test.ts`, `dashboard-service.unit.test.ts`, `social.unit.test.ts` («Mis recursos»), `http-api-client-my-resources.unit.test.ts`, `my-resources.unit.test.ts`, `MyResourcesTab.unit.test.tsx` y `PublicDashboardIsland.unit.test.tsx`.

## Riesgos abiertos 2026-11-16 (#530)

- `resources.created_by` no tiene índice. Con decenas de miles de recursos importados (#508) cada visita a «Mis recursos» recorre la tabla dos veces (lista y contadores). No se ha añadido migración; si se nota, la 0024 puede crear el índice.
- El orden es fijo (última edición primero); no hay selector de orden.
- El filtro por etiqueta admite una sola etiqueta, como en `/explorar`.
