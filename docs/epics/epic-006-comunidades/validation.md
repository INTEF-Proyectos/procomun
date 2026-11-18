# Validation — Épica 006: comunidades

## Estado
Plan de validación (2026-11-16, revisado el 2026-11-18 tras la revisión de #578). Todavía no hay código; las pruebas se escriben en cada feature, primero en rojo.

## Criterios
| Requisito | Cómo se valida | Feature |
|---|---|---|
| RF-001 «Comunidades» en la navegación, escritorio y móvil | Test de `PublicLayout` (enlace, estado activo) y e2e en viewport móvil | F2 |
| RF-002, RF-004 Solo publicadas en listado, API pública, feeds y sitemap | Integración: una comunidad de cada estado; solo sale la publicada | F1 |
| RF-003 Búsqueda y filtros | Integración del repositorio: texto con y sin tildes, etiquetas, administrador, fechas, modalidad | F1 |
| RF-005, RF-006 Nueve metadatos y recuentos | Test de la ficha con una comunidad completa. Integración: el público ve el recuento de miembros y los nombres de quienes administran, nunca la lista ni correos | F1, F2 |
| RF-007, RF-009 Privada: descripción sí, contenido no, también por API | Integración: anónimo, autenticado no miembro, miembro, AC y `admin` contra `GET …/resources` y `…/members` | F1 |
| RF-010 a RF-013 Solicitud y aprobación | Integración: crear (`pending`), aprobar solo `admin` (403 al resto), creador como AC, rechazo con motivo, `PATCH status` directo a `published` rechazado | F1, F3 |
| RF-014 Unirse a una pública (**provisional**, Q-13) | Integración: una pública une al momento. Si #493 responde que hace falta aprobación, el test pasa a esperar una solicitud, como RF-015 | F3 |
| RF-015 Solicitar ingreso | Integración: privada crea solicitud única; AC acepta y rechaza; no miembro no puede aceptar. Al aceptar, rechazar o retirar no queda la fila ni el mensaje | F3 |
| RF-016 Invitaciones | Integración: token válido, caducado (14 días), revocado, otra cuenta; misma respuesta exista o no la cuenta. Un test por estado de cierre (aceptada, rechazada, caducada y revocada): no quedan correo ni `token_hash` | F3 |
| RF-017, RF-018, RF-024 Administrador obligatorio | Unitarias e integración: quitar, degradar, expulsar o abandonar el último AC → 409; publicar sin AC → 409 | F1 |
| RF-024 Baja lógica del último administrador | Integración sin purga: la baja lógica del único AC pasa la comunidad a `draft` en la misma transacción y la membresía sigue; con otro AC sigue publicada; un fallo forzado en el cambio de estado deja la cuenta sin dar de baja; deshacer la baja no la vuelve a publicar. Cuenta bloqueada según la respuesta a Q-8 | F1 |
| RF-019 Roles globales intactos | Test: ser AC no da permisos sobre recursos ni colecciones; un `curator` sin pertenencia no gestiona comunidades | F1 |
| RF-020 a RF-022 Contenido | Integración: enlazar publicado sí, borrador no; despublicar el recurso lo oculta sin borrar el enlace; el recurso no cambia de estado | F1 |
| RF-026 Visitas | Unitarias con el patrón de ADR-0044: una por sesión, solo publicadas, sin usuario ni IP. Sujeto a la decisión sobre el contador de #577 | F1 |
| RF-027 a RF-036 Importador | Mapeo puro y PGlite con un JSON sintético de los cinco casos de #495: estados, modalidades, relaciones asociadas y no resueltas, `draft` sin administrador, informe, `--dry-run`, reimportación sin cambios | F4 |
| RF-037 Reimportación | PGlite: reimportar tras expulsar, tras degradar, tras abandonar y tras desenlazar no deshace nada; caso 607 con el administrador importado después: AC asignado, sigue en `draft` y aviso `admin_resolved_draft` | F4 |
| Accesibilidad | Tests de componentes (roles, nombres accesibles, `aria-live`), revisión con teclado y lector de pantalla, contraste con los tokens | F2 |
| Datos personales | Test: ninguna respuesta pública lleva correos; informe del importador sin correos ni nombres; invitación cerrada sin correo | F1, F3, F4 |

## Casos del importador (#495)
La tabla «Resultado esperado» de `design.md` es el oráculo de la prueba de integración de F4. Los datos reales de los adjuntos se usan solo en local; el fixture del repositorio es sintético y reproduce la misma forma.

## Comprobaciones de cada PR
`bun run paraglide:compile`, `bun run check-types`, `bun run check-coverage`, `bun run check-test-files`, `bun run check-tracking` y `bun run lint` (desde la copia principal o en el CI).

## Validación de esta entrega (F0, 2026-11-16)
Solo documentación: `bun run check-tracking` valida `status.yaml` y `decision-log.yaml`.

## Segunda revisión de #578 — 2026-11-18
| Requisito | Prueba prevista | Feature |
|---|---|---|
| RF-038 Identidad por UID | PGlite: UID y correo en cuentas distintas no asignan miembro ni administrador, relación `pending` con `identity_conflict`, informe sin correo, comunidad en `draft` con `no_admin` si era el único administrador; UID resuelto asigna a su cuenta; tras vincular el UID, la reimportación aplica una sola vez | F4 |
| RF-039 Invitación con correo verificado | Integración: correo coincidente sin verificar no ve ni acepta (404 genérico, sin membresía) por enlace y por «Mis comunidades»; cuenta verificada acepta y rechaza por ambas vías; otro correo, cuenta de baja o bloqueada, no; respuesta idéntica exista o no la cuenta | F3 |

## Tercera revisión de #578 — 2026-11-18

### Resolución manual de `identity_conflict` (RF-040, F4, PGlite)
Caso: el UID legado `legacy-procomun:user:<uid>` ya está vinculado a la cuenta A (activa), el correo del JSON pertenece a la cuenta B y era el único administrador de la comunidad.

| # | Paso | Resultado esperado |
|---|---|---|
| 1 | Primera importación | Relación `pending` con `identity_conflict`; ni A ni B reciben el rol; comunidad en `draft` con `no_admin`; informe sin correo |
| 2 | Reimportar el mismo JSON sin resolución | Sigue `identity_conflict`; nada cambia |
| 3 | Un usuario sin rol `admin` (incluido el administrador de la comunidad) intenta registrar la resolución | Rechazado (403); no se crea fila |
| 4 | Registrar la resolución con el UID aún sin vincular | Rechazado; no se crea fila |
| 5 | Un `admin` registra la resolución confirmando la cuenta A | Una fila en `community_legacy_resolutions` con `resolved_by`, UID y `user_id` = A, sin correo ni en la nota; un evento en `activity_events` sin correo; segunda resolución vigente para la misma relación: rechazada |
| 6 | Reimportar el mismo JSON (UID ya vinculado, correo todavía en B) | A recibe el rol de administrador **una sola vez**; B no recibe nada; relación `applied`; informe `applied_by_resolution` sin correo; la comunidad **sigue en `draft`** con `admin_resolved_draft` |
| 7 | Reimportar de nuevo | Sin cambios: no hay segundo rol ni segundo evento; la comunidad sigue en `draft` |
| 8 | Un administrador publica la comunidad de forma explícita | Pasa a `published`; solo entonces |
| 9 | Resolución revocada antes de reimportar | Vuelve `identity_conflict`; no se asigna |
| 10 | La cuenta del UID cambia o se da de baja tras la resolución | La resolución no vale: `identity_conflict` otra vez |
| 11 | Inspección de tablas, informe y logs | Ningún correo del JSON aparece en `community_legacy_resolutions`, `community_legacy_relations`, `activity_events`, informe ni logs |

El mismo escenario con `kind = member` asigna la membresía de miembro a A una sola vez y no cambia el estado de la comunidad.
