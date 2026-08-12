# ADR-0031 Verificación de correo en el registro y capa de envío de email

* Estado: Aceptado
* Fecha: 2026-06-23
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/backend-api-servicios, @.agents/skills/devops-sre, @.agents/skills/qa-validacion]

## Contexto

El alta pública crea cuentas sin comprobar la titularidad del correo. Better Auth aporta tokens y endpoints, pero necesita una función de entrega. La activación debe ser gradual y no puede generar verificaciones con el flag apagado ni escribir enlaces en logs de producción.

## Decisión

1. Se adopta `EmailPort` con `SmtpEmailTransport` mediante Nodemailer y `LogEmailTransport` solo en `development`, `test` o CI (`CI=true`/`1`).
2. `AUTH_REQUIRE_EMAIL_VERIFICATION` controla tanto `emailVerification.sendOnSignUp` como `emailAndPassword.requireEmailVerification`.
3. Con el flag apagado no se genera ni envía automáticamente una verificación durante el alta.
4. La configuración se valida al arrancar: flag booleano, caducidad positiva, puerto válido, TLS booleano, credenciales completas y remitente.
5. Activar la función sin SMTP fuera de development/test/CI impide el arranque (fail-closed también si `NODE_ENV` está vacío o es un entorno de despliegue tipo staging).
6. `getEmailTransport` nunca degrada al transporte de log fuera de development/test/CI.
7. Better Auth sigue gestionando tokens, caducidad, tabla de verificaciones y endpoint de confirmación.

## Configuración

| Variable | Regla |
|---|---|
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` o `false`; defecto `false` |
| `EMAIL_VERIFICATION_EXPIRES_IN` | entero positivo; defecto `3600` |
| `SMTP_HOST` | obligatorio fuera de development/test/CI cuando el flag está activo |
| `SMTP_PORT` | entero entre 1 y 65535 |
| `SMTP_SECURE` | `true` o `false` |
| `SMTP_USER` / `SMTP_PASS` | ambos o ninguno |
| `MAIL_FROM` | obligatorio con SMTP fuera de development/test/CI |

## Consecuencias

### Positivas

- El rollout apagado conserva el comportamiento previo sin verificaciones ocultas.
- Los tokens no terminan en logs de production/staging ni con `NODE_ENV` vacío.
- Los despliegues incoherentes fallan antes de aceptar tráfico.
- SMTP mantiene portabilidad entre proveedores.

### Negativas

- Una configuración inválida detiene el arranque de forma deliberada.
- SMTP añade responsabilidad operativa y de entregabilidad.
- La UI de aviso y reenvío queda para un follow-up.

## Validación

Tests de configuración inválida, transporte de log solo en development/test/CI, selección SMTP, flag apagado y envío mediante transporter inyectado. El flujo browser completo se validará antes de activar el flag.

## Actualización 2026-08-06 — reenvío en el login y variables vacías

Revisión de @juanda sobre PR #235. No se altera nada de lo anterior; se concreta.

1. `AUTH_REQUIRE_EMAIL_VERIFICATION` controla también `emailVerification.sendOnSignIn`, además de `sendOnSignUp` y `requireEmailVerification` (punto 2). Sin esa opción, Better Auth rechaza el login de una cuenta sin verificar pero no reenvía nada: quien pierda o deje caducar el correo inicial queda bloqueado hasta que exista la UI de reenvío. Better Auth comprueba la verificación **después** de validar la contraseña, así que el reenvío no es un vector de envío masivo por terceros.
2. Las tres opciones se derivan en `buildEmailVerificationOptions(config)` para que la correspondencia flag → comportamiento sea única y esté cubierta por tests.
3. `SMTP_PORT` y `EMAIL_VERIFICATION_EXPIRES_IN` tratan la cadena vacía como «sin definir» y caen al valor por defecto, igual que ya hacía `SMTP_SECURE`. Antes, `Number("")` valía `0` y una plantilla de despliegue que interpolara una variable sin definir tumbaba el arranque incluso con la verificación apagada. Un valor presente pero no entero o fuera de rango sigue siendo un error de arranque.
4. `EMAIL_VERIFICATION_EXPIRES_IN` acota el máximo a 30 días para que una caducidad absurda no convierta el enlace en permanente.
