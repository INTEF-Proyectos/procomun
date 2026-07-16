# Diseño — Verificación de correo en el registro (DEF-003 / #200)

## Referencias

- Issue #200.
- [ADR-0030](../../negocio/decisiones/0030-verificacion-email-registro.md).

## Objetivo

Cuando la función está activa, el alta debe exigir que la persona demuestre control del correo. El despliegue debe ser gradual, no generar verificaciones cuando el flag está apagado y no filtrar tokens en logs de producción.

## Requisitos

- El mismo flag controla `sendOnSignUp` y `requireEmailVerification`.
- La caducidad es un entero positivo configurable.
- SMTP es obligatorio en producción cuando se activa la función.
- El transporte de log solo se permite en desarrollo, test y CI.
- Puerto, TLS, credenciales y remitente se validan al arrancar.
- Better Auth conserva la responsabilidad sobre tokens, caducidad y verificación.

## Diseño

La capa de email expone:

```ts
EmailMessage = { to: string; subject: string; text: string; html?: string }
EmailPort = { sendEmail(message: EmailMessage): Promise<void> }
LogEmailTransport
SmtpEmailTransport
```

`resolveSmtpConfig` valida:

- `SMTP_PORT` entre 1 y 65535;
- `SMTP_SECURE` como booleano estricto;
- `SMTP_USER` y `SMTP_PASS` juntos;
- `MAIL_FROM` obligatorio con SMTP en producción.

`resolveEmailVerificationConfig` valida el flag y `EMAIL_VERIFICATION_EXPIRES_IN`. Con `AUTH_REQUIRE_EMAIL_VERIFICATION=true` y `NODE_ENV=production`, la ausencia de SMTP impide el arranque.

```ts
const config = resolveEmailVerificationConfig(process.env);

emailVerification: {
  sendVerificationEmail,
  sendOnSignUp: config.enabled,
  autoSignInAfterVerification: true,
  expiresIn: config.expiresIn,
},
emailAndPassword: {
  enabled: true,
  minPasswordLength: 8,
  requireEmailVerification: config.enabled,
},
```

## Variables

| Variable | Defecto | Regla |
|---|---:|---|
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `false` | booleano estricto |
| `EMAIL_VERIFICATION_EXPIRES_IN` | `3600` | entero positivo |
| `SMTP_HOST` | vacío | obligatorio en producción con el flag activo |
| `SMTP_PORT` | `587` | 1–65535 |
| `SMTP_SECURE` | `false` | `true`/`false` |
| `SMTP_USER` / `SMTP_PASS` | vacío | ambos o ninguno |
| `MAIL_FROM` | local fuera de producción | obligatorio con SMTP en producción |

## Despliegue

1. Desplegar con el flag apagado.
2. Configurar SMTP y remitente.
3. Verificar entrega y SPF/DKIM/DMARC.
4. Activar el flag y reiniciar.
5. Monitorizar errores y reenvíos.

## Pruebas

- Flag apagado: no bloquea login ni envía al registrarse.
- Producción sin SMTP: error de configuración.
- Transporte de log prohibido en producción.
- Puerto, TLS, credenciales, remitente y caducidad inválidos.
- Flujo activo completo y reenvío en el follow-up de frontend/E2E.

## Estado

Backend y validación implementados. Pendiente la experiencia frontend y el E2E completo antes de activar la función en producción.
