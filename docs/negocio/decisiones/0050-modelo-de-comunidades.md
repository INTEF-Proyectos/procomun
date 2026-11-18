# ADR-0050 Modelo de comunidades

* Estado: Propuesto
* Fecha: 2026-11-16
* Agentes Implicados: [@.agents/skills/empresa-y-producto, @.agents/skills/arquitectura-solucion, @.agents/skills/evaluacion-tecnologica, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/ingestas-y-migraciones, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

#493 pide recuperar las comunidades del Procomún antiguo (unas 55): espacios de docentes, públicos o privados, con miembros, administradores y contenido enlazado, y crear comunidades nuevas con aprobación de la administración. #495 pide importarlas desde el JSON del exportador.

Decisiones de negocio del 2026-11-16 (jacoboAlcantara, en #493 y #495):

- No hay foros, comentarios ni avisos dentro de las comunidades.
- Los recursos son siempre públicos; la comunidad solo los enlaza.
- Las solicitudes de ingreso las aprueban los administradores de la comunidad, con los `admin` de la plataforma de respaldo.
- Toda comunidad tiene al menos un administrador, quien la crea. Sin administrador, queda en borrador y sin publicar.
- La migración se hace a mano con un comando de terminal (el importador de #495), no programada.
- Hay que crear comunidades nuevas y añadir «Comunidades» a la navegación.

Restricciones: no modificar los roles globales (`reader`, `author`, `editor`, `curator`, `admin`) para resolver necesidades de las comunidades (#493); autorización en el servidor; datos personales mínimos (#504); reutilizar taxonomías, etiquetas y visitas.

AGENTS.md pide evaluar antes si hay una solución de mercado.

## Opciones Consideradas

* **A. Plataforma de comunidades externa** (HumHub, Discourse, Open Social sobre Drupal o grupos de Moodle) integrada por SSO.
* **B. Ampliar `collections`** con un tipo «comunidad», visibilidad y miembros.
* **C. Plugin `organization` de Better Auth**, que la plataforma ya usa para la autenticación (1.7.18).
* **D. Tablas propias de comunidad** en PostgreSQL con Drizzle, reutilizando las taxonomías, etiquetas, visitas y patrones de importación existentes.

### A. Plataforma externa
* A favor: membresía, roles e invitaciones resueltos; algunas tienen grupos privados con solicitud.
* En contra: lo que traen de más (foros, muros, mensajería) es justo lo que se ha descartado y añade moderación. Los recursos viven en Procomún, así que el enlace, el contador, el buscador interno y el filtro por tipo habría que programarlos igual, ahora entre dos sistemas. Supone otro servicio que desplegar, actualizar y acreditar en el ENS (ADR-0015), una segunda copia de datos personales de los docentes (#504) y una navegación fuera del diseño y la accesibilidad de la plataforma. Lock-in alto en datos y en interfaz.

### B. Ampliar colecciones
* A favor: ya existen la tabla, el enlace con recursos, la portada y una interfaz de listado; el importador de itinerarios (#573) usa el mismo patrón.
* En contra: una colección es una selección ordenada de un propietario con su propio flujo editorial (borrador, revisión, publicación) y permisos de `curator` (#433, #538, #573). Una comunidad no tiene orden, sí miembros, solicitudes, invitaciones, modalidad pública o privada y una aprobación distinta (`admin` aprueba la creación). Mezclarlas llenaría `collections` de columnas que solo usa un tipo y complicaría los permisos recién ajustados en #538 y #573.

### C. Plugin `organization` de Better Auth
Documentación de la 1.7 consultada: organizaciones con `name`, `slug`, `logo` y `metadata`; roles `owner`, `admin` y `member`; invitaciones por correo; `allowUserToCreateOrganization` para limitar quién crea; organización activa en la sesión.
* A favor: misma librería; miembros, roles e invitaciones hechos.
* En contra: está pensado para multiinquilino (la organización activa de la sesión limita lo que ve el usuario), que aquí no aplica. No ofrece en la documentación consultada solicitudes de ingreso con aprobación, modalidad pública o privada, cola de aprobación de la creación ni metadatos con FK a etiquetas, áreas o contexto educativo; habría que programarlos a su lado. Mete las comunidades en el esquema de autenticación, cuyas migraciones controla la librería, y ata el modelo a sus actualizaciones. La pertenencia a comunidades se mezclaría con los permisos del plugin `admin` que ya define los roles globales.

### D. Tablas propias
* A favor: modela solo lo pedido; integridad con FK y restricciones; reutiliza `tags`, `knowledge_areas`, la categorización educativa, el contador de visitas de ADR-0044, el patrón `import_source`/`external_id` y la resolución de cuentas legacy de #488 y #508; permisos por pertenencia sin tocar los globales; sin servicios nuevos ni datos personales fuera.
* En contra: hay que programar membresía, solicitudes e invitaciones (unas cinco tablas y sus rutas) y mantenerlas.

## Decisión

Se elige **D, tablas propias de comunidad**. Las opciones A y C resuelven lo que menos cuesta (miembros e invitaciones) y dejan sin resolver lo específico (enlace con recursos, modalidad, aprobación, taxonomías, importación), con más dependencias y más datos personales fuera. B reutiliza poco y complica las colecciones.

El modelo:

1. `communities` con los nueve metadatos de #493 más los campos técnicos justificados en el diseño: `slug`, `visibility` (`public`/`private`), `status` (`pending`/`rejected`/`draft`/`published`), datos de revisión y trazabilidad legacy (`import_source`, `external_id`, `legacy_search_id`, `legacy_urls`).
2. Modalidad y estado son independientes: «privada» no es «no publicada».
3. `community_members` con rol de comunidad `admin` o `member`, independiente de los roles globales. Solo el `admin` global actúa sobre cualquier comunidad.
4. `community_join_requests` y `community_invitations` para el acceso a las privadas; las públicas se unen al momento (**provisional**, pendiente de confirmar en #493; si se pide aprobación, usan el mismo flujo de solicitud). Las invitaciones caducan a los 14 días. El correo de la invitación y la solicitud con su mensaje se borran en cualquier estado de cierre.
5. `community_resources` enlaza recursos publicados, artículos incluidos (son recursos de tipo «Artículo» desde #517). Enlazar no cambia la visibilidad ni el estado del recurso.
6. Invariante: una comunidad publicada tiene al menos un administrador con cuenta no dada de baja. Sin él, `draft`. Lo garantiza el servicio en transacción, con comprobación de diagnóstico. La baja lógica de una cuenta pasa a `draft`, en la misma transacción, las comunidades que se quedan sin administrador; no se espera a la purga. Qué pasa con una cuenta bloqueada depende de Q-8.
7. La creación pasa por `pending` y solo un `admin` la aprueba; al aprobar, el creador es su primer administrador.
8. Etiquetas, áreas, contexto educativo y visitas con tablas de unión a las taxonomías existentes.
9. Importador `import:legacy-communities` de ejecución manual, idempotente por (`import_source`, `external_id`). `community_legacy_relations` registra cada relación del JSON como pendiente o aplicada. Reimportar no vuelve a aplicar las ya aplicadas, no cambia roles existentes y no cambia el estado de una comunidad ya importada: un administrador que aparece después entra, pero la comunidad sigue en borrador.
10. Datos personales, regla común con ADR-0051 (#577) y pendiente de validar con negocio y la responsable legal: el público ve el número de miembros y el nombre de quienes administran; la lista de miembros, solo los miembros, sus administradores y los `admin`.

Detalle en `docs/epics/epic-006-comunidades/design.md`. Revisión del 2026-11-18 (#578): puntos 4, 6, 9 y 10; detalle en el apartado «Revisión del 2026-11-18» del diseño.

## Consecuencias

### Positivas
* Sin servicios nuevos ni datos fuera de la plataforma.
* Las comunidades usan las mismas etiquetas, áreas y contexto que los recursos, así que los filtros y la calidad del metadato son coherentes.
* Los roles globales no cambian; los permisos de comunidad se prueban por separado.
* El importador sigue el mismo patrón que los de usuarios, recursos e itinerarios.

### Negativas / Riesgos
* Membresía, solicitudes e invitaciones son desarrollo propio que hay que mantener.
* La invariante del administrador vive en el servicio; una escritura directa en la base podría romperla. Se mitiga con el comando de diagnóstico y, si hace falta, un trigger diferido.
* Las listas de miembros son datos personales: su visibilidad depende de #504 y de la respuesta a Q-3.
* El importador necesita una correspondencia entre los IDs Drupal de ODE y artículos y los recursos importados, que hoy no se guarda (Q-11 del diseño).

## Notas de Implementación

* Features F1 (modelo y API), F2 (interfaz), F3 (solicitudes e invitaciones) y F4 (importador) en `docs/epics/epic-006-comunidades/tasks.md`.
* Migración con el siguiente número libre al implementar; revisar antes los PR abiertos.
* Al implementar F1, adenda fechada en ADR-0008 con las funciones de autorización de comunidad.
* Esta ADR pasa a «Aceptado» cuando INTEF responda las preguntas abiertas del diseño (Q-1 a Q-14), o se actualiza con lo que respondan.
