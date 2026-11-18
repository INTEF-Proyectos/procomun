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

## Revisión de #578 — 2026-11-18
- [x] Reimportación que respeta expulsiones, degradaciones, abandonos y enlaces quitados, y regla única de estado para el caso 607 (`design.md` R-1, RF-037).
- [x] Baja lógica del último administrador: deja de contar en la baja, no en la purga, y el cambio a `draft` va en la misma transacción (`design.md` R-2, RF-024). Q-8 revisada con las opciones para la cuenta bloqueada.
- [x] Regla común con #577: el público ve el recuento y quién administra, invitaciones a 14 días y borrado del correo y de la solicitud en cualquier cierre (`design.md` R-3). Propuesta pendiente de validar con negocio y la responsable legal.
- [x] Incorporación directa a las públicas marcada como provisional en requisitos, ADR-0050 y validación (`design.md` R-4).
- [ ] Resolver Q-8, Q-13 y Q-14 con negocio (y Q-14 con la responsable legal).
- [ ] F1: envolver `softDeleteUser` en una transacción que también pase a `draft` las comunidades sin administrador, con sus pruebas.
- [ ] F3: borrado del correo y del token en cada estado de cierre de las invitaciones, y de la solicitud al cerrarse, con sus pruebas.
- [ ] F4: `community_legacy_relations` con estado `pending`/`applied` y pruebas de reimportación de R-1.

## Segunda revisión de #578 — 2026-11-18
- [x] Identidad por UID legado y conflicto UID/correo pendiente de revisión sin guardar el correo (`design.md` R-5, RF-038).
- [x] Invitaciones solo con cuenta activa y correo verificado, en ambas vías y en el servidor (`design.md` R-6, RF-039).
- [ ] F4: resolver por UID, `identity_conflict` en `community_legacy_relations` y las cinco pruebas de R-5.
- [ ] F3: función de servidor única para listar y aceptar invitaciones con correo verificado y las cinco pruebas de R-6.
- [ ] Q-15: confirmar con #577 la regla común de identidad por UID.

## Tercera revisión de #578 — 2026-11-18
- [x] Resolución manual autorizada de `identity_conflict`: registro, auditoría sin correo y uso por el importador (`design.md` R-7, RF-040).
- [ ] F4: tabla `community_legacy_resolutions`, endpoint o subcomando `resolve`, uso en el importador y las pruebas de «Resolución manual de `identity_conflict`» de `validation.md`.
- [ ] Q-16: confirmar quién puede registrar resoluciones.
