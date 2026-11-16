# Tasks — Épica 007: protección de datos en el área de usuario

## Diseño — 2026-11-16 (issue #504)
- [x] Recoger las respuestas del INTEF en #504 (2026-11-03 y 2026-11-16).
- [x] Comprobar en el código el estado actual: registro, baja lógica, `user_profile`, Gravatar y almacenamiento en el navegador.
- [x] Redactar `requirements.md`, `design.md` y `validation.md`.
- [x] ADR-0051 «Tratamiento de datos personales y baja de cuentas» (Propuesto).
- [ ] Publicar en #504 las preguntas pendientes (menores, recursos tras la baja, primer acceso de los importados y conservación del registro de bajas).
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
