# Tasks — Épica 006: comunidades

## Estado: En planificación (2026-11-16)

Fuente: #493 y #495. Diseño en `design.md`; modelo en [ADR-0050](../../negocio/decisiones/0050-modelo-de-comunidades.md). Cada feature se entrega en su propio PR, con su test rojo → verde, y añade aquí una sección fechada al cerrarse.

## F0 — Documentación y decisiones (#493, #495)
- [x] Leer #493 y #495 con todos los comentarios y las decisiones del 2026-11-16.
- [x] Revisar lo que ya existe: colecciones, etiquetas, áreas, categorización, visitas, importadores legacy, roles.
- [x] `requirements.md`, `design.md`, `tasks.md` y `validation.md` de la épica.
- [x] ADR-0050 «Modelo de comunidades» con las alternativas evaluadas.
- [ ] Resolver las preguntas abiertas Q-1 a Q-12 del diseño con INTEF y pasar la ADR-0050 a «Aceptado».

## F1 — Modelo de datos y API (#493)
Depende de F0 (al menos Q-1, Q-2 y Q-3).
- [ ] Migración con el siguiente número libre al implementar (hoy la 0023; revisar los PR abiertos): `communities`, `community_members`, `community_join_requests`, `community_invitations`, `community_resources`, `community_tags`, `community_knowledge_areas`, `community_educational_areas`, `community_view_counts`, `community_view_sessions`, `community_legacy_relations`. Esquema Drizzle, `createTables` y test de migraciones.
- [ ] Repositorio de comunidades con transacciones y bloqueo de fila en altas, bajas, cambios de rol y de estado.
- [ ] Permisos: `canViewCommunity`, `canViewCommunityContent`, `canManageCommunity`, `canReviewCommunityRequest`. Tests con cada actor, modalidad y estado.
- [ ] Invariante «publicada ⇒ al menos un administrador»: rechazar las acciones que la rompen y pasar a `draft` al borrar la cuenta del último administrador. Comando de diagnóstico `communities:check`.
- [ ] Rutas públicas `/api/v1/communities…` y de gestión `/api/admin/communities…` del diseño. Tests de llamadas directas que intentan saltarse la aprobación o ver contenido privado.
- [ ] Búsqueda del listado: `search_vector`, índice GIN parcial, filtros por etiquetas, administrador, fecha y modalidad.
- [ ] Visitas con el mecanismo de ADR-0044.
- [ ] Eventos en `activity_events`.
- [ ] Adenda fechada en ADR-0008 con los permisos de comunidad.

## F2 — Interfaz pública y de gestión (#493)
Depende de F1.
- [ ] «Comunidades» en la navegación superior y en el pie de `PublicLayout`.
- [ ] `/comunidades`: listado con buscador, filtros y paginación; modalidad visible sin depender del color.
- [ ] `/comunidades/:slug`: ficha con los nueve metadatos, recuentos, administradores, contenido con buscador y filtro por tipo, y botón «Unirme» o «Solicitar ingreso» según la modalidad.
- [ ] `/comunidades/nueva`: formulario de solicitud reutilizando los selectores de etiquetas, áreas y contexto educativo de los recursos.
- [ ] `/comunidades/:slug/gestionar`: metadatos, solicitudes, invitaciones, miembros y contenido.
- [ ] «Mis comunidades» en el perfil.
- [ ] Textos en Paraglide (es, en, ca, gl, eu), WCAG 2.1 AA y tests de componentes; e2e del flujo principal.

## F3 — Solicitudes, aprobación e invitaciones (#493)
Depende de F1; la interfaz se apoya en F2.
- [ ] Cola «Solicitudes de comunidad» en el panel de administración: aprobar (el creador pasa a administrador) y rechazar con motivo.
- [ ] Límite de solicitudes de creación pendientes por usuario.
- [ ] Solicitudes de ingreso a privadas: crear, cancelar, aceptar y rechazar.
- [ ] Invitaciones con token, caducidad y respuesta igual exista o no la cuenta; borrado del correo al cerrarse.
- [ ] Lista «Sin administrador» en el panel y asignación de administrador por un `admin`.
- [ ] Tests de integración de cada flujo, incluidos los 403/404 por API directa.

## F4 — Importador de comunidades (#495)
Depende de F1, de #488 (usuarios), #517 (artículos) y de Q-11 (correspondencia de IDs Drupal).
- [ ] Mapeo puro `packages/db/src/legacy-import/community.ts` con las reglas del diseño: modalidad, estado por `published` del nivel superior, `-` como vacío, HTML a texto, fechas y etiquetas.
- [ ] Resolución de usuarios por correo (regla de #508) y, si no hay correo, por `legacy-procomun:user:<uid>`.
- [ ] Resolución de ODE y artículos según la respuesta a Q-11.
- [ ] `community_legacy_relations` para lo no resuelto y reintento al reimportar.
- [ ] Sin administrador resuelto: `draft` y aviso `no_admin`.
- [ ] CLI `import:legacy-communities --source-file … [--dry-run] [--limit] [--only] [--report-dir]`, registrado en `apps/cli/src/index.ts` y en la ayuda.
- [ ] Informe por comunidad sin correos ni nombres.
- [ ] Test de integración con un JSON sintético que reproduce los cinco casos de #495 y la tabla de resultados del diseño; reimportación sin cambios.
- [ ] Adenda en la ADR-0029 o en `docs/epics/epic-004-migracion-legacy-procomun/` con el orden de importación: usuarios, ODE, artículos, itinerarios, comunidades.

## Deuda y riesgos abiertos
- [ ] Trigger diferido para la invariante del administrador, si la comprobación en el servicio no basta.
- [ ] Denuncias de comunidades (fuera de alcance; Q-5).
- [ ] Comunidades en la búsqueda general y faceta «comunidad» en el catálogo.
- [ ] Redirecciones desde las URL antiguas (`/comunidades/<id>`) con `legacy_urls`.
