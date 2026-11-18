# Requirements — Épica 006: comunidades

## Fecha
2026-11-16

## Fuente
- Requisito: issue #493 (apartado «Comunidades», creación y acceso) e issue #495 (importador de comunidades del Procomún antiguo).
- Decisiones de negocio: respuestas de jacoboAlcantara del 2026-11-16 en #493 y #495.
- Contexto legacy: `docs/casos/inventario-funcional-procomun-actual/README.md` (apartado 8, «Comunidades») y `docs/casos/matriz-decision-funcional-procomun/README.md` (F2-18, F2-19, F2-25).
- Datos de prueba: adjuntos de #495 (`Prueba_montar_comunidades.json` con las cinco comunidades de prueba y `ejemplo_comunidad.json` con una comunidad más).
- Decisión de modelo: [ADR-0050](../../negocio/decisiones/0050-modelo-de-comunidades.md).
- Dependencias: #504 (protección de datos), #488 y #508 (cuentas importadas y autoría), #517 (artículos importados como recursos de tipo «Artículo»).

## Problema
El Procomún antiguo tiene unas 55 comunidades temáticas de docentes que agrupan recursos y artículos. La plataforma nueva no tiene comunidades: solo colecciones curatoriales. Sin ellas, los grupos de docentes pierden su punto de encuentro y los recursos que enlazaban, y no se pueden crear comunidades nuevas.

## Usuarios
- **Docente autenticado:** busca comunidades de su área, se une a ellas, propone comunidades nuevas y comparte sus recursos.
- **Administrador de comunidad:** quien crea la comunidad y quien él designe. Gestiona solicitudes, invitaciones, miembros, contenido y metadatos de su comunidad.
- **Administrador de la plataforma (`admin`):** aprueba o rechaza la creación de comunidades y hace de respaldo de los administradores de comunidad.
- **Visitante anónimo:** consulta el listado y la información descriptiva de las comunidades.
- **Equipo de migración:** ejecuta a mano, por terminal, el importador de comunidades.

## Objetivo
Recuperar las comunidades del Procomún antiguo, sin funciones que no existían, y permitir crear comunidades nuevas con aprobación de la administración, integradas con los recursos, las taxonomías y el sistema de permisos actuales.

## Decisiones de negocio cerradas (2026-11-16)
- D1. No hay foros, comentarios ni avisos dentro de las comunidades. No se recuperan.
- D2. Los recursos son siempre públicos. Una comunidad solo los enlaza; pertenecer a una comunidad pública o privada no cambia su visibilidad.
- D3. Las solicitudes de ingreso las aprueban los administradores de cada comunidad, con los `admin` de la plataforma como respaldo. Lo mismo para las invitaciones.
- D4. Toda comunidad tiene al menos un administrador: quien la crea.
- D5. Si no se puede asignar ningún administrador (por ejemplo, porque su cuenta no se exportó), la comunidad queda en borrador, sin publicar, hasta que se le asigne uno. No se publica sin administrador.
- D6. La migración la ejecuta a mano el equipo responsable con comandos de terminal. Hace falta el importador de #495; no se programa ni se automatiza. El punto 9 de #493 se entiende así.
- D7. Además de migrar, se crean comunidades nuevas en la aplicación, con una pestaña «Comunidades» en la navegación y el flujo de solicitud y aprobación de #493.
- D8. El exportador incluirá el correo de miembros y administradores para asociarlos con sus cuentas.

## Requisitos funcionales

### Navegación y listado
- RF-001: la navegación principal tiene un apartado «Comunidades», junto a «Colecciones», en escritorio y en móvil.
- RF-002: el listado muestra las comunidades publicadas, públicas y privadas, con su modalidad indicada.
- RF-003: el listado permite buscar por texto y filtrar por etiquetas, administradores y fecha, como el Procomún antiguo; también por modalidad.
- RF-004: ninguna comunidad pendiente, rechazada o en borrador aparece en el listado, la API pública, los feeds ni el sitemap.

### Ficha de la comunidad
- RF-005: la ficha muestra los nueve metadatos de #493: título, fecha, usuario creador, imagen, texto, etiquetas, áreas de conocimiento, contexto educativo y número de visitas.
- RF-006: la ficha muestra el número de miembros y de recursos, y el nombre para mostrar de los administradores. La lista de miembros no se muestra al público (regla común con #577, `design.md` R-3, pendiente de validar con negocio y la responsable legal).
- RF-007: en una comunidad privada, quien no es miembro ve la información descriptiva (RF-005 y RF-006) y la opción de solicitar el ingreso, pero no el contenido interno (ver Q-1 en `design.md`).
- RF-008: el contenido de la comunidad es la lista de recursos y artículos enlazados que estén publicados, con buscador interno y filtro por tipo de recurso con su recuento.
- RF-009: las restricciones de acceso se aplican en el servidor, no solo ocultando elementos de la interfaz.

### Creación y aprobación
- RF-010: un usuario autenticado puede solicitar la creación de una comunidad con título, descripción, imagen, etiquetas, áreas de conocimiento, contexto educativo, modalidad y alias de URL.
- RF-011: la solicitud queda pendiente y su autor ve su estado (pendiente, aprobada, rechazada con motivo).
- RF-012: solo un `admin` de la plataforma aprueba o rechaza. Al aprobar, la comunidad queda publicada en su modalidad y su creador es su primer administrador.
- RF-013: no se puede activar una comunidad sin aprobación, tampoco con llamadas directas a la API.

### Membresía
- RF-014: en una comunidad pública, un usuario autenticado se une directamente (comportamiento del Procomún antiguo). **Provisional**: pendiente de confirmar en #493 (Q-13, `design.md` R-4). Si se pide aprobación, las públicas siguen el flujo de RF-015.
- RF-015: en una comunidad privada, un usuario autenticado solicita el ingreso; un administrador de la comunidad, o un `admin` de la plataforma, lo acepta o lo rechaza. Al cerrarse (aceptada, rechazada o retirada), la solicitud se borra con su mensaje (`design.md` R-3).
- RF-016: un administrador de la comunidad, o un `admin` de la plataforma, invita a una persona; la invitación se acepta o se rechaza y caduca a los 14 días. El correo se borra en cualquier estado de cierre: aceptada, rechazada, caducada o revocada (`design.md` R-3, regla común con #577 pendiente de validar).
- RF-017: un administrador de la comunidad nombra y retira administradores y expulsa miembros. No se puede quitar ni expulsar al último administrador de una comunidad publicada.
- RF-018: un miembro puede abandonar la comunidad. El último administrador no puede hacerlo sin nombrar antes a otro.
- RF-019: los roles de comunidad (`admin`, `member`) no cambian los roles globales de la plataforma.

### Contenido
- RF-020: los administradores de la comunidad enlazan y desenlazan recursos y artículos publicados. Propuesta pendiente de confirmar (Q-2): los miembros enlazan sus propios recursos publicados.
- RF-021: enlazar un recurso no cambia su estado, su visibilidad ni sus permisos.
- RF-022: si un recurso enlazado deja de estar publicado o se borra, desaparece del contenido de la comunidad sin borrar la comunidad.

### Estados y administrador obligatorio
- RF-023: los estados son `pending`, `rejected`, `draft` y `published`. La modalidad (`public`/`private`) es independiente del estado.
- RF-024: una comunidad sin administrador queda o pasa a `draft`. No se puede publicar sin al menos un administrador. Un administrador deja de contar en cuanto su cuenta se da de baja (baja lógica, `deleted_at`), sin esperar a la purga, y el cambio a `draft` se hace en la misma transacción que la baja (`design.md` R-2). El caso de la cuenta bloqueada depende de Q-8.
- RF-025: un `admin` de la plataforma puede asignar administradores a cualquier comunidad, despublicarla y publicarla si tiene administrador.

### Visitas
- RF-026: la ficha cuenta visitas como los recursos (ADR-0044): una por sesión de pestaña, solo en comunidades publicadas, sin datos personales.

### Importador (#495)
- RF-027: comando de terminal que lee el JSON exportado (array de comunidades) y valida cada registro.
- RF-028: importa `label`, `description`, `type`, `published`, `urlDrupal` y los metadatos aprovechables, y guarda la relación entre ID Drupal, ID de Elasticsearch e ID interno.
- RF-029: `type` da la modalidad (`community` pública, `community_private` privada) y el `published` del nivel superior da el estado; no se usa `metadata.published`.
- RF-030: `-` significa sin relaciones. HTML, saltos de línea y caracteres especiales se tratan bien.
- RF-031: asocia miembros, administradores, recursos y artículos ya importados, y registra uno a uno los que no encuentra, sin abortar la comunidad ni el lote.
- RF-032: sin administrador resuelto, la comunidad queda en `draft` (D5), aunque `published` sea 1.
- RF-033: es idempotente: reimportar no duplica comunidades ni relaciones.
- RF-037: reimportar respeta lo decidido en la plataforma: no cambia el estado de una comunidad ya importada, no vuelve a añadir miembros expulsados o que se fueron ni recursos desenlazados, y no cambia el rol de una membresía existente. Un administrador que aparece después (caso 607) entra como administrador y la comunidad sigue en `draft` (`design.md` R-1).
- RF-034: genera un informe por comunidad (creada, actualizada, sin cambios o fallida; miembros, administradores, recursos y artículos asociados y no resueltos; advertencias y errores) con detalle suficiente para reintentar.
- RF-035: admite `--dry-run`, `--limit`, `--only <id>` y `--report-dir`, como los demás importadores legacy.
- RF-036: se ejecuta a mano; no hay importación programada.

## Requisitos no funcionales
- Accesibilidad WCAG 2.1 AA en listado, ficha, formularios y paneles de gestión; textos con Paraglide en es, en, ca, gl y eu; sin colores fijos.
- Autorización en el servidor para cada acción; los permisos de comunidad se resuelven por pertenencia, no por rol global.
- Integridad en base de datos: claves foráneas, unicidad de miembro por comunidad, de solicitud pendiente por usuario y comunidad y de enlace por recurso y comunidad.
- Datos personales mínimos (ver diseño, apartado «Datos personales» y #504): la API pública nunca devuelve correos; las listas de miembros no son públicas.
- El informe del importador no lleva correos ni nombres (criterio de #543).
- Rendimiento: el listado y la ficha paginan; los recuentos no recorren tablas enteras en cada petición.

## Fuera de alcance
- Foros, comentarios, avisos o mensajería dentro de las comunidades (D1).
- Recursos o artículos visibles solo para miembros (D2).
- Denuncias de comunidades (la tabla `reports` es solo de recursos). Ver Q-5.
- Notificaciones por correo de solicitudes, salvo la de invitación si se decide así (Q-4).
- Importación programada o automática (D6).
- Comunidades dentro de la búsqueda general de recursos y faceta «comunidad» en el catálogo.
- Directorio público de usuarios.

## Métricas de éxito
- Las comunidades del Procomún antiguo importadas, con sus relaciones disponibles asociadas y las no resueltas listadas en el informe.
- Ninguna comunidad publicada sin administrador (comprobable con una consulta).
- Tiempo desde la solicitud de creación hasta la decisión del `admin`.
- Comunidades nuevas creadas, miembros por comunidad y recursos enlazados por comunidad.
- Visitas a las fichas de comunidad.

## Segunda revisión de #578 — 2026-11-18
- RF-038: el importador resuelve a miembros y administradores por el UID legado (`legacy-procomun:user:<uid>`) como referencia principal. Si el UID y el correo apuntan a cuentas distintas, la relación queda pendiente de revisión, se refleja en el informe sin correo y no se asigna automáticamente ni la membresía ni el rol de administrador (`design.md` R-5). Sustituye la regla del apartado «Importador» que buscaba primero por correo.
- RF-039: una invitación por correo solo se muestra y se acepta desde una cuenta activa con ese correo verificado, con la misma regla aplicada en el servidor en el enlace y en «Mis comunidades» (`design.md` R-6). Complementa RF-016.

## Tercera revisión de #578 — 2026-11-18

- RF-040: un usuario `admin` puede registrar una resolución manual autorizada para una relación del importador en `identity_conflict` cuando el UID legado ya está vinculado a una cuenta activa. La resolución guarda comunidad, tipo, UID, cuenta confirmada, quién la registra y cuándo, **sin correo**, y queda auditada en `activity_events`. En la siguiente ejecución el importador no abre el conflicto para esa relación, la aplica una sola vez a la cuenta confirmada por UID e ignora el correo del JSON. La comunidad no se publica sola: si estaba en `draft` por no tener administrador, sigue en `draft` hasta una publicación explícita (`design.md` R-7). Complementa RF-038.
