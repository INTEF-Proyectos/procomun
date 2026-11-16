# Validation — Épica XX: protección de datos en el área de usuario

## Fecha
2026-11-16

## Estado
Diseño. No hay código todavía: la tabla recoge la evidencia que tendrá que aportar cada fase.

## Criterios
| Requisito | Evidencia esperada |
|---|---|
| RF-001 Primera capa en el registro | Test de componente del registro: se muestran responsable, finalidad, base, derechos y enlace a la privacidad |
| RF-002 Casilla obligatoria | Test de la API: el alta sin aceptación devuelve error; test de componente: no se envía sin marcar |
| RF-003 Aceptación versionada | Test de integración: se guarda documento, versión y fecha; con versión nueva se vuelve a pedir |
| RF-004 Primer acceso | Test de integración: una cuenta importada o OIDC sin aceptación recibe `403 terms_not_accepted` en rutas autenticadas, salvo aceptar, cerrar sesión y baja |
| RF-005 Enlaces legales | Test de componente del pie y e2e de la portada |
| RF-006 «Tus datos» | Test de componente: enlace a la sede y acciones disponibles |
| RF-007 y RF-008 Baja y recursos | Tests de integración de la purga para las tres elecciones; los recursos conservados siguen accesibles y con sus ficheros |
| RF-009 Visibilidad del perfil | Test de la API pública del autor: solo salen los campos públicos y nunca el correo |
| RF-010 Miembros de comunidades | Tests de la API de comunidades: un no miembro solo ve el número de miembros |
| RF-011 Sin terceros | E2e que carga las páginas principales y falla con peticiones a otros orígenes o almacenamiento no inventariado |
| RF-012 Foto con consentimiento | Test de integración: sin consentimiento no se guarda; al retirarlo se borra |
| RF-013 Registro de bajas | Test de integración: la purga escribe `account_removals` sin nombre ni correo y borra lo que supera el plazo |

## Transversal
- Accesibilidad: revisión con axe de registro, `/condiciones`, «Tus datos» y baja.
- i18n: textos nuevos en es, en, ca, gl y eu.
- Validación legal: la responsable legal del INTEF revisa los textos y las decisiones de ADR-0051 antes de abrir la plataforma a usuarios reales.
