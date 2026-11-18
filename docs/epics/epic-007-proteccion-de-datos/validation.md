# Validation — Épica 007: protección de datos en el área de usuario

## Fecha
2026-11-16 (revisado el 2026-11-18 tras la revisión de #577)

## Estado
Diseño. No hay código todavía: la tabla recoge la evidencia que tendrá que aportar cada fase.

## Criterios
| Requisito | Evidencia esperada |
|---|---|
| RF-001 Primera capa en el registro | Test de componente del registro: se muestran responsable, finalidad, base, derechos y enlace a la privacidad |
| RF-002 Casilla obligatoria | Test de la API: el alta sin aceptación devuelve error; test de componente: no se envía sin marcar |
| RF-003 Aceptación versionada | Test de integración: se guarda documento, versión y fecha; con versión nueva se vuelve a pedir. Test del catálogo (`design.md` §12.2): la versión configurada tiene fuente y su huella coincide, y tras añadir una versión nueva se recupera el texto de la anterior con su huella |
| RF-004 Primer acceso | Test de integración: una cuenta importada o OIDC sin aceptación recibe `403 terms_not_accepted` en rutas autenticadas, salvo aceptar, cerrar sesión y baja |
| RF-005 Enlaces legales | Test de componente del pie y e2e de la portada |
| RF-006 «Tus datos» | Test de componente: enlace a la sede y acciones disponibles |
| RF-007 y RF-008 Baja y recursos | Tests de integración de la purga para conservar y borrar: los recursos conservados siguen accesibles y con sus ficheros, y su autor en texto no cambia. Casos CA-1, CA-2 y CA-6 de `design.md` §12.1 |
| RF-009 Visibilidad del perfil | Test de la API pública del autor: solo salen los campos públicos y nunca el correo |
| RF-010 Miembros de comunidades | Tests de la API de comunidades: quien no es miembro ve el número de miembros y los nombres de quienes administran, nunca la lista ni correos. Un test por cada estado de cierre de invitaciones y solicitudes que compruebe que no quedan el correo ni el mensaje (`design.md` §12.4) |
| RF-011 Sin terceros | E2e que carga las páginas principales y falla con peticiones a otros orígenes o almacenamiento no inventariado |
| RF-011 Decisión sobre el contador de visitas | Antes de abrir a usuarios reales, una de las tres salidas de `design.md` §12.3: (1) confirmación escrita de la responsable legal, enlazada desde la épica; (2) e2e que abre una ficha y comprueba que no se escriben `procomun:view-session` ni `procomun:viewed:*` en `sessionStorage`; o (3) e2e que comprueba que, sin consentimiento, no se escriben esas claves ni se llama a la API de visitas, y que sí se hace tras aceptar |
| RF-012 Foto con consentimiento | Test de integración: sin consentimiento no se guarda; al retirarlo se borra |
| RF-013 Registro de bajas | Test de integración: la purga escribe `account_removals` sin nombre ni correo y borra lo que supera el plazo |
| RF-014 Retirada de atribución | Tests de integración de CA-3, CA-4 y CA-5 (`design.md` §12.1): se quita solo el nombre pedido, se mantienen los coautores, el recurso se reindexa, el evento no guarda el nombre y la cuenta del publicador no cambia |

## Transversal
- Accesibilidad: revisión con axe de registro, `/condiciones`, «Tus datos» y baja.
- i18n: textos nuevos en es, en, ca, gl y eu.
- Validación legal: la responsable legal del INTEF revisa los textos y las decisiones de ADR-0051 antes de abrir la plataforma a usuarios reales.

## Ampliación del 2026-11-18 (segunda revisión de #577)

| Requisito | Evidencia esperada |
|---|---|
| RF-003 Texto exacto presentado (CA-7) | Test de integración: el formulario devuelve las versiones presentadas y el enlace de cada una es su fuente exacta, no la página general. Si se publica una versión nueva con el formulario abierto, el envío devuelve `terms_version_changed` y no crea aceptación de esa versión; tras mostrar y confirmar los textos vigentes, se guarda la nueva |
| RF-014 Restauración (CA-8) | Test de integración de `restoreResourceVersion`: tras una retirada aprobada, restaurar una versión que incluía a la persona deja su nombre fuera de la ficha y de la búsqueda (reindexado) y mantiene a los demás coautores. Un autor con nombre parecido que no fue retirado no se suprime |
