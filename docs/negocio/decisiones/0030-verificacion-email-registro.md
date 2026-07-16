# ADR-0030 Verificación de correo en el registro y capa de envío de email

* Estado: Aceptado
* Fecha: 2026-06-23
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/backend-api-servicios, @.agents/skills/devops-sre, @.agents/skills/qa-validacion]

## Contexto

El alta pública crea cuentas sin comprobar la titularidad del correo. Better Auth aporta tokens y endpoints, pero necesita una función de entrega. La activación debe ser gradual y no puede generar verificaciones con el flag apagado ni escribir enlaces en logs de producción.

## Decisión

1. Se adopta `EmailPort` con `SmtpEmailTransport` mediante Nodemailer y `LogEmailTransport` solo fuera de producción.
2. `AUTH_REQUIRE_EMAIL_VERIFICATION` controla tanto `emailVerification.sendOnSignUp` como `emailAndPassword.requireEmailVerification`.
3. Con el flag apagado no se genera ni envía automáticamente una verificación durante el alta.
4. La configuración se valida al arrancar: flag booleano, caducidad positiva, puerto válido, TLS booleano, credenciales completas y remitente.
5. En producción, activar la función sin SMTP impide el arranque.
6. En producción, `getEmailTransport` nunca degrada al transporte de log.
7. Better Auth sigue gestionando tokens, caducidad, tabla de verificaciones y endpoint de confirmación.

## Configuración

| Variable | Regla |
|---|---|
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` o `false`; defecto `false` |
| `EMAIL_VERIFICATION_EXPIRES_IN` | entero positivo; defecto `3600` |
| `SMTP_HOST` | obligatorio en producción cuando el flag está activo |
| `SMTP_PORT` | entero entre 1 y 65535 |
| `SMTP_SECURE` | `true` o `false` |
| `SMTP_USER` / `SMTP_PASS` | ambos o ninguno |
| `MAIL_FROM` | obligatorio con SMTP en producción |

## Consecuencias

### Positivas

- El rollout apagado conserva el comportamiento previo sin verificaciones ocultas.
- Los tokens no terminan en logs de producción.
- Los despliegues incoherentes fallan antes de aceptar tráfico.
- SMTP mantiene portabilidad entre proveedores.

### Negativas

- Una configuración inválida detiene el arranque de forma deliberada.
- SMTP añade responsabilidad operativa y de entregabilidad.
- La UI de aviso y reenvío queda para un follow-up.

## Validación

Tests de configuración inválida, transporte de log prohibido en producción, selección SMTP, flag apagado y envío mediante transporter inyectado. El flujo browser completo se validará antes de activar el flag.
