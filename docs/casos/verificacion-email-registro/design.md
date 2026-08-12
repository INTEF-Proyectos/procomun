# Diseño — Verificación de correo en el registro (DEF-003 / #200)

## Referencias

- Issue #200.
- [ADR-0031](../../negocio/decisiones/0031-verificacion-email-registro.md).

## Objetivo

Cuando la función está activa, el alta debe exigir que la persona demuestre control del correo. El despliegue debe ser gradual, no generar verificaciones cuando el flag está apagado y no filtrar tokens en logs de producción.

## Requisitos

- El mismo flag controla `sendOnSignUp` y `requireEmailVerification`.
- La caducidad es un entero positivo configurable.
- SMTP es obligatorio fuera de development/test/CI cuando se activa la función.
- El transporte de log solo se permite en development, test y CI (`CI=true`/`1`); nunca con `NODE_ENV` vacío, `production` o `staging`.
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

`resolveEmailVerificationConfig` valida el flag y `EMAIL_VERIFICATION_EXPIRES_IN`. Con `AUTH_REQUIRE_EMAIL_VERIFICATION=true` fuera de development/test/CI, la ausencia de SMTP impide el arranque.

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
| `SMTP_HOST` | vacío | obligatorio fuera de development/test/CI con el flag activo |
| `SMTP_PORT` | `587` | 1–65535 |
| `SMTP_SECURE` | `false` | `true`/`false` |
| `SMTP_USER` / `SMTP_PASS` | vacío | ambos o ninguno |
| `MAIL_FROM` | local solo en development/test/CI | obligatorio con SMTP fuera de development/test/CI |

## Despliegue

1. Desplegar con el flag apagado.
2. Configurar SMTP y remitente.
3. Verificar entrega y SPF/DKIM/DMARC.
4. Activar el flag y reiniciar.
5. Monitorizar errores y reenvíos.

## Pruebas

- Flag apagado: no bloquea login ni envía al registrarse.
- Production/staging (o `NODE_ENV` vacío) sin SMTP: error de configuración.
- Transporte de log prohibido fuera de development/test/CI.
- Puerto, TLS, credenciales, remitente y caducidad inválidos.
- Flujo activo completo y reenvío en el follow-up de frontend/E2E.

## Estado

Backend y validación implementados. Pendiente la experiencia frontend y el E2E completo antes de activar la función en producción.

## Actualización 2026-08-06 — reenvío en el login y variables vacías

Revisión de @juanda sobre PR #235. Se añade sin retirar nada de lo anterior.

### `sendOnSignIn`

Con el flag activo, Better Auth rechazaba el login de una cuenta sin verificar sin reenviar la verificación. Si el correo inicial se pierde o caduca, la cuenta queda bloqueada hasta que exista la UI de reenvío del follow-up. El flag pasa a controlar también `sendOnSignIn`. El reenvío ocurre después de validar la contraseña, por lo que no es un vector de envío masivo desde fuera.

Las tres opciones derivadas del flag se construyen en un único sitio:

```ts
// apps/api/src/email/transport.ts
buildEmailVerificationOptions(config) => {
  sendVerificationEmail,
  sendOnSignUp: config.enabled,
  sendOnSignIn: config.enabled,
  autoSignInAfterVerification: true,
  expiresIn: config.expiresIn,
}

// apps/api/src/auth/config.ts
emailVerification: buildEmailVerificationOptions(emailVerificationConfig),
emailAndPassword: { ..., requireEmailVerification: config.enabled },
```

### Variables vacías

`SMTP_PORT` y `EMAIL_VERIFICATION_EXPIRES_IN` tratan la cadena vacía como «sin definir» y caen al valor por defecto, con el mismo criterio que `SMTP_SECURE`. Motivo: las plantillas de despliegue interpolan variables sin definir como cadena vacía y `Number("")` es `0`, que hacía fallar el arranque incluso con la verificación apagada. Un valor presente pero inválido sigue impidiendo el arranque. `EMAIL_VERIFICATION_EXPIRES_IN` se acota a 30 días.

### Pruebas añadidas

- Flag apagado: `sendOnSignUp` y `sendOnSignIn` en `false`.
- Flag activo: ambos en `true` y caducidad propagada.
- `sendVerificationEmail` entrega por el transporte del entorno y falla en producción sin SMTP en lugar de escribir el token.
- `SMTP_PORT` y `EMAIL_VERIFICATION_EXPIRES_IN` vacíos caen al defecto; valores no enteros siguen fallando.

### Adenda UX — 2026-08-12

Con la verificación activa, el endpoint público de configuración expone únicamente
`emailVerificationRequired`; no revela datos de SMTP ni tokens. Tras un alta
correcta la interfaz conserva el correo indicado y sustituye el formulario por un
mensaje con `role="status"`: confirma el envío, pide abrir el enlace y recuerda
comprobar correo no deseado. El alta con el flag apagado mantiene la redirección
anterior al perfil.

El alta incluye `callbackURL=/perfil?verified=1` en la solicitud a Better Auth.
Después de una verificación válida y del auto-login, el perfil comprueba esa marca
solo tras confirmar una sesión, muestra «Correo verificado. Has iniciado sesión…»
con `role="status"` y elimina el parámetro de la URL para no repetir el aviso al
recargar. Esto da feedback explícito sin crear una sesión ni mostrar éxito ante
un enlace inválido o caducado.
