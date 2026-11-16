# Requirements — Épica XX: protección de datos en el área de usuario

## Fecha
2026-11-16

## Fuente
- Requisito: issue #504, que sale de la comparativa de #494.
- Respuestas del INTEF en #504: comentario del 2026-11-03 (responsable, textos, foto, menores) y comentario del 2026-11-16 (textos legales, texto del registro, base jurídica, derechos, borrado de usuarios y menores).
- Issues relacionadas: #533 (perfil ampliado), #493 (comunidades), #488 y #456 (importador de usuarios), #540 (OIDC).
- Decisión: [ADR-0051](../../negocio/decisiones/0051-tratamiento-datos-personales-y-baja-de-cuentas.md).
- Antecedentes: ADR-0015 (ENS, que es seguridad y no protección de datos), ADR-0037 (perfil y migración de usuarios), ADR-0044 (contador de visitas sin datos personales), ADR-0027 (fachada para los embebidos del `.elpx`) y `docs/epics/ens/evaluacion-rgpd.md`.

## Problema
La plataforma nueva no tiene nada de protección de datos en el área de usuario: el registro no informa ni pide aceptar nada, no hay páginas legales, no se explica cómo ejercer los derechos y no hay forma de darse de baja. Sin esto no puede abrirse a usuarios reales.

## Usuarios
- **Docente o ciudadano que se registra**: tiene que saber quién trata sus datos, para qué y cómo ejercer sus derechos.
- **Usuario importado del Procomún antiguo**: tiene cuenta en la plataforma nueva sin haber visto sus condiciones.
- **Quien reutiliza recursos**: depende de que los recursos publicados no desaparezcan sin aviso cuando su autor se da de baja.
- **Equipo de administración**: atiende las solicitudes que llegan por la sede del Ministerio.

## Hechos de partida (facilitados por el INTEF)
- **Responsable**: INTEF. El tratamiento del Procomún antiguo se llama «Red social docente». Adaptar el RAT queda en manos del INTEF.
- **Base jurídica**: art. 6.1.e del RGPD (misión realizada en interés público), con la Ley Orgánica 2/2006, de Educación, modificada por la Ley Orgánica 3/2020.
- **Textos legales vigentes** (no se copian; se enlazan):
  - [Aviso legal](https://procomun.intef.es/es/contenido/aviso_legal)
  - [Política de privacidad](https://procomun.intef.es/es/contenido/politica_de_privacidad)
  - [Política de cookies](https://procomun.intef.es/es/contenido/politica_de_cookies)
- **Texto del registro**: el INTEF facilitó en #504 el texto que muestra hoy el registro del Procomún antiguo. Es la referencia de contenido para la capa informativa.
- **Derechos**: acceso, rectificación, oposición, supresión, limitación, portabilidad y no ser objeto de decisiones automatizadas, según la base jurídica. Se ejercen en la [sede electrónica del Ministerio](https://www.educacionyfp.gob.es/servicios-al-ciudadano/catalogo/varios/proteccion-datos.html), en las oficinas de registro o por correo postal.
- **Baja en el Procomún antiguo**: se borran el usuario y sus contenidos, y en `intef_users_removed` se guardan `uid`, `name`, `surname`, `mail` y `remove_date`.
- **Foto**: el INTEF indicó el 2026-11-03 que la foto necesita consentimiento.
- **Menores**: no hay procedimiento específico. Queda pendiente decidir si se incorpora.

## Estado actual de la plataforma nueva (comprobado en el código el 2026-11-16)
- El formulario de registro (`RegisterIsland.tsx`) no muestra información de protección de datos ni pide aceptar nada.
- No hay páginas de aviso legal, privacidad ni cookies, ni enlaces a ellas.
- La baja que hace un administrador (`softDeleteUser`) solo marca `deleted_at`, desactiva y banea la cuenta y borra sus sesiones. No borra datos ni recursos.
- `user_profile` (#488) guarda centro, su web, país, localidad, «Sobre mí», web personal y redes, y ningún endpoint lo expone.
- El avatar se pide a Gravatar desde el navegador con el SHA-256 del correo (`apps/frontend/src/lib/gravatar.ts`): Gravatar recibe ese hash y la IP en cada carga.
- Almacenamiento en el navegador: cookie de sesión de Better Auth, `localStorage["catalog-view"]` (vista de cuadrícula o lista) y un UUID por pestaña en `sessionStorage` para el contador de visitas (ADR-0044).
- Varias tablas apuntan a `user` con `ON DELETE CASCADE` (`upload_sessions`, `ratings`, `favorites`, `api_tokens`, `user_profile`, `session`, `account`), y `resources.created_by`, `resource_versions.created_by` y `collections` apuntan sin acción de borrado. Un borrado físico del usuario, hoy, o fallaría o arrastraría las subidas de recursos publicados.

## Requisitos funcionales
- **RF-001** El registro muestra una primera capa informativa (responsable, finalidad, base jurídica, derechos y enlace a la política de privacidad) antes de enviar el formulario.
- **RF-002** El registro exige marcar «He leído la información sobre protección de datos y acepto las condiciones de uso». Es una aceptación de las condiciones y un acuse de la información, no un consentimiento al tratamiento.
- **RF-003** Cada aceptación se guarda con usuario, documento, versión y fecha. Cuando cambia la versión de un documento, se vuelve a pedir en el siguiente acceso.
- **RF-004** Las cuentas creadas sin pasar por el formulario (importadas del Procomún antiguo o creadas al entrar por OIDC) ven la información y aceptan en su primer acceso, antes de poder usar la plataforma.
- **RF-005** Todas las páginas enlazan en el pie al aviso legal, la política de privacidad y la política de cookies.
- **RF-006** El área de usuario tiene una sección «Tus datos» que explica qué datos se guardan, remite a la sede para ejercer los derechos y ofrece lo que ya se puede hacer en la plataforma (editar el perfil, cambiar visibilidad, darse de baja).
- **RF-007** El usuario puede darse de baja desde su cuenta, con confirmación y reautenticación. La baja también la puede ejecutar un administrador cuando la solicitud llega por la sede.
- **RF-008** La baja aplica a los recursos de la cuenta la política que fije la ADR-0051 (ver `design.md`, §5).
- **RF-009** Los campos del perfil (#533) son privados por defecto y cada uno se hace público solo por acción expresa del usuario. El correo nunca es público.
- **RF-010** En las comunidades (#493), los datos de los miembros solo los ven quienes los necesitan (ver `design.md`, §7).
- **RF-011** La plataforma solo usa almacenamiento técnico o de preferencias en el navegador y no envía datos a terceros sin una acción del usuario. Con eso no hace falta banner de cookies.
- **RF-012** La foto de perfil solo se usa con el consentimiento del usuario, que puede retirarlo.
- **RF-013** Cada baja deja un registro mínimo, con un plazo de conservación definido y borrado automático al cumplirse.

## Requisitos no funcionales
- Accesibilidad WCAG 2.1 AA en la capa informativa, la pantalla de aceptación, la sección «Tus datos» y el flujo de baja.
- Textos de interfaz con Paraglide en es, en, ca, gl y eu. Los textos legales los proporciona el INTEF; mientras solo existan en castellano, las demás lenguas lo indican y enlazan la versión en castellano.
- La aceptación y la baja quedan en `activity_events`.
- Los filtros de visibilidad del perfil y de los miembros se aplican en el servidor, no solo en la interfaz.
- Ninguna petición a terceros al cargar una página de la plataforma (salvo contenido embebido tras pulsar su fachada, ADR-0027).

## Fuera de alcance
- Redactar los textos legales: los facilita y valida el INTEF.
- El registro de actividades de tratamiento (RAT) y una posible EIPD: los gestiona el INTEF.
- El procedimiento de la sede del Ministerio.
- Las cookies o rastreadores que pueda contener el contenido de un `.elpx` de terceros, más allá de la fachada de ADR-0027.

## Decisiones pendientes
Ver `design.md`, §11. Las preguntas al INTEF se publican en #504: menores, recursos de quien se da de baja, aceptación de los importados en su primer acceso y conservación del registro de bajas.
