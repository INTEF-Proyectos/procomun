# Tasks — Épica 007: protección de datos en el área de usuario

## Diseño — 2026-11-16 (issue #504)
- [x] Recoger las respuestas del INTEF en #504 (2026-11-03 y 2026-11-16).
- [x] Comprobar en el código el estado actual: registro, baja lógica, `user_profile`, Gravatar y almacenamiento en el navegador.
- [x] Redactar `requirements.md`, `design.md` y `validation.md`.
- [x] ADR-0051 «Tratamiento de datos personales y baja de cuentas» (Propuesto).
- [x] Publicar en #504 las preguntas pendientes (menores, recursos tras la baja, primer acceso de los importados y conservación del registro de bajas). Publicadas el 2026-11-16 en el comentario 6920218373.
- [ ] Pasar a la responsable legal la redacción de la casilla, la consulta sobre el UUID del contador y la del art. 17.3.b.
- [ ] Aceptar o ajustar ADR-0051 con las respuestas.

Cada tarea de implementación se abre como issue propia y lleva tests automatizados antes de marcarse.

## Fase 1 — Información y aceptación
- [ ] Pie con enlaces al aviso legal, la privacidad y las cookies del INTEF, con los destinos en configuración.
- [ ] Primera capa informativa y casilla obligatoria en el registro (cinco idiomas).
- [ ] Tabla `legal_acceptances`, versiones en configuración y rechazo en la API del alta sin aceptación.
- [ ] Pantalla `/condiciones` y middleware `terms_not_accepted` para importados, cuentas OIDC y cambios de versión.

## Fase 2 — Perfil y foto
- [ ] Visibilidad por campo del perfil, privada por defecto, filtrada en el servidor (con #533 y la ficha de autor).
- [ ] Quitar Gravatar; subida de foto propia con consentimiento y retirada.
- [ ] Sección «Tus datos» en `/perfil`.

## Fase 3 — Baja y derechos
- [ ] Flujo de baja desde la cuenta con reautenticación y elección sobre los recursos publicados.
- [ ] Cuenta de sistema «Cuenta dada de baja» y reasignación de `created_by`.
- [ ] Proceso de purga a los 30 días que respeta las subidas de recursos conservados.
- [ ] Tabla `account_removals` y borrado automático al cumplirse el plazo.
- [ ] Exportación de los datos de un usuario en JSON (CLI y panel de administración).
- [ ] Baja ejecutada por un administrador con origen `sede` y referencia de expediente.

## Fase 4 — Cookies y comunidades
- [ ] E2e que falla con peticiones a terceros o almacenamiento no inventariado.
- [ ] Reglas de §7 del diseño incorporadas a la épica de comunidades (#493).

## Posterior
- [ ] Páginas legales propias (`/aviso-legal`, `/privacidad`, `/cookies`) cuando el INTEF entregue los textos adaptados.
- [ ] «Descargar mis datos» como autoservicio.

## Revisión de #577 — 2026-11-18
- [x] Separar la desvinculación de la cuenta de la retirada de la atribución, con casos de aceptación (`design.md` §12.1, RF-008 y RF-014).
- [x] Hacer recuperable el texto de cada versión aceptada y ampliar RF-003 (`design.md` §12.2).
- [x] Condicionar la ausencia de banner a la decisión sobre el contador de visitas, con criterio de validación (`design.md` §12.3, RF-011).
- [x] Unificar con la épica 006 la visibilidad de los administradores, la caducidad de las invitaciones (14 días) y el borrado al cerrar solicitudes e invitaciones (`design.md` §12.4). Propuesta pendiente de validar con negocio y la responsable legal.
- [ ] Preguntar al INTEF si publica URLs versionadas de los textos legales o autoriza guardar una copia.
- [ ] Pasar a la responsable legal: retirada de atribución cuando autor y publicador coinciden en una supresión por la sede; borrado de recursos cuyo autor es un tercero; regla común de comunidades.
- [ ] Fase 1: catálogo de versiones de los textos legales con su huella y comprobación de la versión configurada.
- [ ] Fase 3: tarea de administración para retirar la atribución (RF-014) y reindexación.
- [ ] Fase 4: aplicar la salida elegida para el contador de visitas (§12.3) y ajustar el inventario y el e2e.

## Segunda revisión de #577 — 2026-11-18
- [x] Vincular la aceptación al texto exacto presentado, con criterio CA-7 (`design.md` §13.1, RF-003).
- [x] Mantener la retirada de atribución al restaurar versiones, con criterio CA-8 (`design.md` §13.2, RF-014).
- [ ] Fase 1: el formulario envía las versiones presentadas y el servidor devuelve `terms_version_changed` si cambian.
- [ ] Fase 3: `restoreResourceVersion` mantiene la atribución vigente (o aplica las retiradas aprobadas) antes de guardar y reindexar.
- [ ] Acordar con negocio las bajas y la retirada de atribución en #504 y #571 antes de pasar ADR-0051 a Aceptado.
