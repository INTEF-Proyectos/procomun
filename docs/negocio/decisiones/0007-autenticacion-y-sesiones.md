# ADR-0007 Autenticación y gestión de sesiones

* Estado: Aceptado
* Fecha: 2026-03-25
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal/SKILL.md, @.agents/skills/backend-api-servicios/SKILL.md, @.agents/skills/evaluacion-tecnologica/SKILL.md]

## Contexto y Problema

La plataforma necesita autenticación para el área editorial y de administración antes de implementar endpoints de negocio. Los requisitos son:

1. **Login por contraseña** (email + password) para usuarios internos y autores.
2. **OpenID Connect (SSO)** configurable para login institucional (centros educativos, ministerio).
3. **Configurabilidad**: ambos métodos deben poder habilitarse/deshabilitarse por entorno.
4. **Sesiones seguras**: cookies HttpOnly, sin JWT en localStorage.
5. **Compatibilidad**: debe funcionar con Hono (ADR-0003), Drizzle (ADR-0006) y PostgreSQL (ADR-0005) / SQLite (preview).

El mapa de capacidades define autenticación como prioridad alta: "Login con email, SSO educativo".

## Opciones Consideradas

* Better Auth
* Lucia v3 + Arctic
* Hono JWT + desarrollo custom

### Better Auth

**Pros**
- Solución todo-en-uno: password, OIDC, sesiones, verificación de email, reset de contraseña.
- Adaptador Drizzle nativo (`better-auth/adapters/drizzle`) con soporte PostgreSQL.
- Compatible con Hono vía Web Standards (Request/Response).
* Plugin SSO genérico para OIDC, configurable por variables de entorno para soportar proveedores institucionales (EducaMadrid, XTEC, Google Workspace, Microsoft Entra ID, etc.).
- Plugin admin con RBAC integrado (`createAccessControl`).
- Hasheo de contraseñas con Argon2id por defecto.
- MIT, activamente mantenido, comunidad creciente.

**Contras**
- Más opinionado sobre esquema de tablas (user, session, account, verification).
- Dependencia mayor que Lucia.
- Librería relativamente joven comparada con soluciones legacy (Passport.js).

### Lucia v3 + Arctic

**Pros**
- Ligero y composable: Lucia para sesiones, Arctic para OIDC.
- Adaptador Drizzle disponible.
- Control granular sobre el flujo de auth.

**Contras**
- **Lucia v3 está deprecada** por su autor — el sitio oficial recomienda implementar sesiones manualmente usando sus guías como referencia, no usar la librería.
- Requiere ensamblar múltiples librerías (Lucia + Arctic + hasheo + RBAC custom).
- RBAC requiere desarrollo propio.
- Mayor superficie de código a mantener.

### Hono JWT + desarrollo custom

**Pros**
- Middleware JWT integrado en Hono, sin dependencias externas.
- Stateless, escala horizontalmente.

**Contras**
- Contradice la regla 8 del proyecto: "antes de desarrollo propio se evalúa si existe solución de mercado adecuada".
- Sin mecanismo de logout (tokens válidos hasta expiración).
- Requiere construir: hasheo de passwords, flujo OIDC, gestión de sesiones, verificación de email, RBAC.
- JWT en cliente (localStorage) es menos seguro que cookies HttpOnly.

## Decisión

Se adopta **Better Auth** como librería de autenticación y gestión de sesiones.

Justificación principal:

1. **Cubre todos los requisitos en una sola librería**: password + OIDC + sesiones + verificación + RBAC.
2. **Integración nativa con el stack**: adaptador Drizzle, compatible con Hono vía Web Standards.
3. **Menor código custom**: evita ensamblar 3+ librerías y construir RBAC desde cero.
4. **Lucia deprecada**: la alternativa más ligera ya no se mantiene como librería.
5. **Seguridad por defecto**: Argon2id, cookies HttpOnly/Secure/SameSite, CSRF protection.

## Consecuencias

### Positivas
* Se habilita login por password y OIDC con una sola integración.
* Soporte para proveedores SSO educativos mediante el estándar OIDC.
* Provisioning automático de usuarios con rol `reader` por defecto.
* OIDC se activa/desactiva por configuración (`OIDC_ENABLED`, `OIDC_ISSUER`, etc.), cumpliendo requisito de configurabilidad.
* Sesiones server-side con cookies seguras, sin JWT en cliente.
* Verificación de email y reset de contraseña disponibles sin desarrollo adicional.
* El esquema de auth se genera como tablas Drizzle, integrado en el flujo de migraciones existente.

### Negativas / Riesgos
* Esquema de tablas dictado parcialmente por Better Auth (user, session, account, verification) — limita flexibilidad del modelo de usuario.
* Lock-in moderado al API de plugins de Better Auth.
* Librería joven — menor track record que soluciones como Passport.js (pero el ecosistema TS/Bun moderno no tiene alternativas maduras equivalentes).

## Notas de Implementación

1. **Configuración OIDC por entorno**
   ```env
   OIDC_ENABLED=true
   OIDC_ISSUER=https://idp.educacion.gob.es
   OIDC_CLIENT_ID=procomun
   OIDC_CLIENT_SECRET=secret
   ```
   Cuando `OIDC_ENABLED` no está definido, el plugin SSO no se carga.

2. **Montaje en Hono**
   Better Auth se monta como handler catch-all en `/api/auth/*`. El resto de rutas usan middleware de sesión.

3. **Esquema de base de datos**
   - Tabla `user`: alinear con tabla `users` existente, añadiendo campos requeridos por Better Auth (`emailVerified`, `image`).
   - Tablas nuevas: `session`, `account`, `verification`.
   - Actualizar FKs en `resources` y `collections` para referenciar nueva tabla `user`.

4. **Seguridad**
   - Aplicar `csrf()` de Hono en rutas de auth.
   - Rate limiting en endpoints de login/registro.
   - Política de contraseñas mínima: 8 caracteres.

5. **Criterios de revisión**
   Reabrir esta decisión si:
   (a) Better Auth deja de mantenerse o pierde compatibilidad con Bun.
   (b) El esquema de tablas impuesto genera fricción no asumible con el modelo de dominio.
   (c) Requisitos de MFA o auth avanzado exceden las capacidades de los plugins disponibles.

## Actualización 2026-11-03: rutas del acceso OIDC con Better Auth 1.7 (#527)

Better Auth 1.7 (#362, 2026-09-22) rehízo el plugin `genericOAuth` sobre el flujo de los proveedores sociales. Ya no registra rutas propias: `POST /api/auth/sign-in/oauth2` y `/api/auth/oauth2/callback/:id` responden 404. El botón de acceso institucional seguía llamando a la primera y el login OIDC no funcionaba desde entonces. Fuentes: guía de actualización a 1.7 (*Generic OAuth is rebuilt on the social-provider path*) y `better-auth/dist/plugins/generic-oauth/index.mjs` de la 1.7.12.

| | Better Auth 1.6 | Better Auth 1.7 |
|---|---|---|
| Inicio del acceso | `POST /api/auth/sign-in/oauth2` con `{ providerId: "oidc" }` | `POST /api/auth/sign-in/social` con `{ provider: "oidc" }` |
| Vuelta del proveedor | `/api/auth/oauth2/callback/oidc` | `/api/auth/callback/oidc` |

* El frontend (`signInOidc` en `apps/frontend/src/lib/http-api-client.ts`) llama ya a `/api/auth/sign-in/social`.
* **URL de retorno que se da de alta en el proveedor de identidad:** `{BETTER_AUTH_URL}/api/auth/callback/oidc`, donde `BETTER_AUTH_URL` es la URL pública de Procomún (si no está definida se usa `FRONTEND_URL`). En local: `http://localhost:5173/api/auth/callback/oidc`. `oidc` es el `providerId` de `apps/api/src/auth/config.ts`.
* **Despliegue existente:** si el cliente se registró en el proveedor con `{BETTER_AUTH_URL}/api/auth/oauth2/callback/oidc`, hay que sustituirla por la nueva; el proveedor rechaza el acceso si la URL de retorno no coincide. Las cuentas ya vinculadas siguen valiendo: con un proveedor OIDC estándar el identificador de la cuenta es el `sub` en las dos versiones.
* PKCE viene activado por defecto en 1.7 (`pkce: true` en la configuración no cambia nada). Si el proveedor publica `jwks_uri`, Better Auth verifica la firma y el `nonce` del `id_token`, y comprueba el parámetro `iss` de la vuelta.
* `apps/api/src/auth/config.ts` exporta `createAuth(env)` para montar una instancia con otro entorno. `apps/api/src/auth/oidc-sign-in.integration.test.ts` recorre el flujo completo con el cliente real del frontend y un proveedor OIDC de prueba (`Bun.serve`) que solo acepta la URL de retorno nueva, exige PKCE y firma el `id_token`: inicio, autorización, canje del código, userinfo y sesión. Si una actualización de Better Auth cambia las rutas, ese test falla.

## Adenda 2026-11-04 — la pestaña «Cuenta»: cambiar la contraseña y el correo (#532)

**Problema.** No había pantalla para cambiar la contraseña ni el correo. Better Auth trae el cambio de contraseña, y el de correo estaba desactivado (`/change-email` respondía `CHANGE_EMAIL_DISABLED`).

**Decisión sobre el correo: se permite cambiarlo.** La issue lo dejaba abierto porque el correo identifica al autor en las importaciones (#508, #517). Se permite, por tres motivos:

1. **No desvincula nada de lo ya importado.** #508 fija `resources.created_by` al importar y `linkExistingResourceAuthor` **nunca pisa un creador real**. Los recursos ya asignados siguen siendo de la cuenta aunque cambie el correo.
2. **#488 no identifica la cuenta antigua por el correo** sino por `legacy-procomun:user:<uid>`, así que reimportar usuarios tampoco depende de él.
3. **Lo único que cambia es la importación futura.** Un recurso que se importe más adelante con el correo antiguo en `publicatorEmailStr` no encontrará la cuenta, quedará a nombre del usuario de sistema y saldrá en `authorsWithoutAccount` del informe. Es visible y recuperable reasignándolo; impedir que la gente cambie de correo para siempre (quien cambia de centro, de proveedor) es peor.

**Cómo cambia el correo, tal como lo hace Better Auth 1.7:**

* **con el correo actual verificado**, primero un aviso a la dirección **antigua** para confirmar el cambio; después la verificación de la nueva; y solo entonces cambia. Protege la cuenta si alguien ha robado la sesión: el cambio no sigue sin que el dueño lo confirme desde su buzón;
* **sin verificar** (la mayoría de cuentas importadas, #488 deja `email_verified = false`), directo a verificar la nueva;
* **`updateEmailWithoutVerification` queda desactivado**: con él, una cuenta sin verificar podría pasar a otro correo sin demostrar que lo controla;
* **cambiar a un correo que ya tiene cuenta no lo delata**: Better Auth responde lo mismo que con uno libre.

El correo de verificación de Better Auth es el mismo para el alta y para el correo nuevo de un cambio. Decía «Para activar tu cuenta», que es falso en el segundo caso, así que se reescribe para que sirva en los dos.

**Contraseña.** `changePassword` con `revokeOtherSessions: true`: quien la cambia porque sospecha que se la han robado necesita que la otra sesión deje de valer. Indicador de fortaleza orientativo, sin dependencias (zxcvbn pesa unos 800 kB): lo que se exige sigue siendo la longitud mínima de 8.

**Cuentas de acceso institucional.** Si la cuenta no tiene credencial propia (`/list-accounts` sin `credential`), la pestaña no ofrece ninguna de las dos cosas: la contraseña y el correo se gestionan en el proveedor de identidad, y un correo cambiado aquí se desalinearía con el suyo. Si no se puede averiguar, tampoco: ofrecer cambiar una contraseña que no existe acaba en error.

**Validación.** `apps/api/src/auth/account-settings.integration.test.ts`, contra la instancia real de Better Auth: la contraseña nueva sustituye a la vieja; con la actual equivocada no cambia nada y el código es `INVALID_PASSWORD` (el cliente se fía de él); se cierran las demás sesiones; el cambio de correo está activado; sin verificar la dirección nueva el correo no cambia; con el correo verificado el aviso va a la antigua; y cambiar a un correo ocupado no lo delata. Sin el arreglo fallan los dos tests que prueban la funcionalidad, por `CHANGE_EMAIL_DISABLED`.

## Adenda 2026-11-10 — revisión de la pestaña Cuenta (#552)

* **Sin transporte de correo no hay cambio de correo.** En producción sin `SMTP_HOST`, `user.changeEmail.enabled` queda en `false`, `/api/v1/config` devuelve `emailDeliveryEnabled: false` y la pestaña Cuenta esconde el formulario de correo; la contraseña se sigue pudiendo cambiar. Mismo criterio que la recuperación (#551): se descarta exigir SMTP al arrancar porque la imagen corre con `NODE_ENV=production` y el `docker-compose.yml` no trae SMTP.
* La URL de vuelta del cambio de correo se construye con `url()`: respeta la ruta base y el prefijo de idioma.
* Un fallo de red al cambiar la contraseña o el correo enseña el error de conexión traducido.
