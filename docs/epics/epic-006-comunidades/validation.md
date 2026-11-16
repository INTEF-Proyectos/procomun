# Validation — Épica 006: comunidades

## Estado
Plan de validación (2026-11-16). Todavía no hay código; las pruebas se escriben en cada feature, primero en rojo.

## Criterios
| Requisito | Cómo se valida | Feature |
|---|---|---|
| RF-001 «Comunidades» en la navegación, escritorio y móvil | Test de `PublicLayout` (enlace, estado activo) y e2e en viewport móvil | F2 |
| RF-002, RF-004 Solo publicadas en listado, API pública, feeds y sitemap | Integración: una comunidad de cada estado; solo sale la publicada | F1 |
| RF-003 Búsqueda y filtros | Integración del repositorio: texto con y sin tildes, etiquetas, administrador, fechas, modalidad | F1 |
| RF-005, RF-006 Nueve metadatos y recuentos | Test de la ficha con una comunidad completa | F2 |
| RF-007, RF-009 Privada: descripción sí, contenido no, también por API | Integración: anónimo, autenticado no miembro, miembro, AC y `admin` contra `GET …/resources` y `…/members` | F1 |
| RF-010 a RF-013 Solicitud y aprobación | Integración: crear (`pending`), aprobar solo `admin` (403 al resto), creador como AC, rechazo con motivo, `PATCH status` directo a `published` rechazado | F1, F3 |
| RF-014, RF-015 Unirse y solicitar | Integración: pública une al momento; privada crea solicitud única; AC acepta y rechaza; no miembro no puede aceptar | F3 |
| RF-016 Invitaciones | Integración: token válido, caducado, revocado, otra cuenta; misma respuesta exista o no la cuenta | F3 |
| RF-017, RF-018, RF-024 Administrador obligatorio | Unitarias e integración: quitar, degradar, expulsar o abandonar el último AC → 409; borrar su cuenta → `draft`; publicar sin AC → 409 | F1 |
| RF-019 Roles globales intactos | Test: ser AC no da permisos sobre recursos ni colecciones; un `curator` sin pertenencia no gestiona comunidades | F1 |
| RF-020 a RF-022 Contenido | Integración: enlazar publicado sí, borrador no; despublicar el recurso lo oculta sin borrar el enlace; el recurso no cambia de estado | F1 |
| RF-026 Visitas | Unitarias con el patrón de ADR-0044: una por sesión, solo publicadas, sin usuario ni IP | F1 |
| RF-027 a RF-036 Importador | Mapeo puro y PGlite con un JSON sintético de los cinco casos de #495: estados, modalidades, relaciones asociadas y no resueltas, `draft` sin administrador, informe, `--dry-run`, reimportación sin cambios | F4 |
| Accesibilidad | Tests de componentes (roles, nombres accesibles, `aria-live`), revisión con teclado y lector de pantalla, contraste con los tokens | F2 |
| Datos personales | Test: ninguna respuesta pública lleva correos; informe del importador sin correos ni nombres; invitación cerrada sin correo | F1, F3, F4 |

## Casos del importador (#495)
La tabla «Resultado esperado» de `design.md` es el oráculo de la prueba de integración de F4. Los datos reales de los adjuntos se usan solo en local; el fixture del repositorio es sintético y reproduce la misma forma.

## Comprobaciones de cada PR
`bun run paraglide:compile`, `bun run check-types`, `bun run check-coverage`, `bun run check-test-files`, `bun run check-tracking` y `bun run lint` (desde la copia principal o en el CI).

## Validación de esta entrega (F0, 2026-11-16)
Solo documentación: `bun run check-tracking` valida `status.yaml` y `decision-log.yaml`.
