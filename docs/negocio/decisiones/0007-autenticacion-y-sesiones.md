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

## Adenda 2026-11-04 — la URL de cierre de sesión OIDC sale del descubrimiento (#542)

**Problema.** `GET /api/v1/config` construía la URL de cierre de sesión del proveedor como `${OIDC_ISSUER}/connect/endsession`. Esa es la ruta de Duende IdentityServer, el proveedor de demostración que usa el entorno de desarrollo. Keycloak (`/realms/<realm>/protocol/openid-connect/logout`), Azure AD y los demás la publican en otra ruta, así que con cualquier proveedor real el cierre de sesión institucional apuntaba a una URL que no existe.

**Decisión.** La URL sale de `end_session_endpoint` del documento de descubrimiento (`{OIDC_ISSUER}/.well-known/openid-configuration`), que es donde la especificación de OpenID Connect Session Management dice que está. `OIDC_END_SESSION_URL` la fuerza para un proveedor que no la publique.

**Implementación** (`apps/api/src/auth/oidc-discovery.ts`).

- Orden: `OIDC_END_SESSION_URL` → descubrimiento → `null`. Ya no se construye ninguna ruta por nuestra cuenta.
- Solo se acepta una URL absoluta `http(s)`, así que un documento manipulado no puede colar un `javascript:` ni una ruta suelta en el enlace de cierre de sesión.
- Tiempo máximo de 5 s, para que el descubrimiento no cuelgue `/api/v1/config`.
- Se guarda en caché el resultado de un proveedor que responde, incluido el `null` de uno que no publica el campo (es su configuración). Un fallo de red o un 5xx **no** se guardan: el siguiente intento vuelve a probar, para que un corte momentáneo no deje el cierre de sesión roto hasta reiniciar.
- Cualquier fallo devuelve `null` y la interfaz deja de ofrecer el cierre de sesión del proveedor, en vez de llevar a una URL inventada.

**Corrección del mismo día.** La primera versión hacía la consulta **dentro** de `GET /api/v1/config`, con `await`. Que un endpoint dependa de una petición a un tercero es un defecto: lo pagan su latencia y su previsibilidad. Lo descubrió el CI, donde otro fichero de test deja `OIDC_ISSUER` apuntando a un proveedor de prueba ya cerrado —los ficheros de `bun test` comparten proceso— y la petición agotaba el tope mientras el endpoint esperaba. Ahora:

* `getCachedOidcEndSessionUrl` **solo lee la caché** y no espera a la red. Si está fría, lanza el calentado en segundo plano y devuelve `null` esa vez, que es el mismo comportamiento que cuando el proveedor no publica el campo.
* Una única consulta en vuelo por issuer, no una por petición.
* `warmOidcEndSessionUrl` la calienta al arrancar la API, así que en la práctica ya está resuelta cuando alguien cierra sesión. Un fallo no impide arrancar.
* No se consulta nada si `OIDC_ENABLED` no es `true`: sin OIDC la URL no sirve de nada.
* El tope baja a 2 s.

**Validación.** `apps/api/src/auth/oidc-discovery.unit.test.ts`, con un proveedor de prueba: se lee la ruta de Keycloak, nunca se construye la de Duende, la variable manda y no consulta, sin issuer no consulta nada, un proveedor sin el campo da `null`, se descartan los valores que no son URL http(s), el acierto se guarda en caché y el fallo no, un error de red da `null` y una barra final en el issuer no duplica la barra.

## Adenda 2026-11-04 — la recuperación de contraseña, conectada (#531)

**Problema.** Esta ADR daba la recuperación de contraseña por disponible «sin desarrollo adicional» porque Better Auth la trae. Pero `sendResetPassword` no estaba configurado, así que `POST /api/auth/request-password-reset` no enviaba nada, y no había ni enlace en la pantalla de acceso ni pantalla para la contraseña nueva. Quien olvidaba la contraseña se quedaba fuera. Y es la **única vía de entrada** de los usuarios importados cuya contraseña no se pudo traer (#488: un hash en formato no admitido no se importa).

**Decisión.** Se conecta con la capa de correo de ADR-0031, igual que la verificación:

* `buildPasswordResetOptions` (`apps/api/src/email/transport.ts`) aporta `sendResetPassword` y `resetPasswordTokenExpiresIn` a `emailAndPassword`.
* **Caducidad de 1 hora** por defecto, configurable con `PASSWORD_RESET_EXPIRES_IN` entre 60 s y 24 h. El tope es deliberado: mientras vale, el enlace **equivale a la contraseña**.
* Enlace de un solo uso, que es el comportamiento propio de Better Auth. El correo lo dice, para que nadie lo guarde esperando reutilizarlo.
* Pantallas `/recuperar` (pedir) y `/restablecer` (elegir la nueva), con el enlace «¿Has olvidado tu contraseña?» bajo el botón de acceso.

**No revelar qué correos están registrados.** La pantalla de petición responde **siempre lo mismo**, exista o no la cuenta. En el cliente, `requestPasswordReset` devuelve `ok` salvo fallo de red: un error del servidor aquí solo puede delatar que esa cuenta no está, y eso convertiría la pantalla en un comprobador de correos. El fallo de red sí se distingue, porque ahí no se ha enviado nada y hay que reintentar. Hay un test de integración que compara código y cuerpo de las dos respuestas.

**El enlace y los logs.** El token viaja en la query de una ruta del frontend (`/restablecer?token=…`). Con #524 el `access_log` de nginx **no registra la query**, así que queda como `/restablecer?:query`; y `api_access_logs` guarda solo la ruta, sin query. **Esto depende de que #524 entre**: hasta entonces, un token de recuperación aparecería entero en el `access_log` de la imagen `frontend`.

**El correo no repite el destinatario en el cuerpo.** Ya va en el `to`, y así un reenvío no lo reparte otra vez.

**Validación.** `apps/api/src/email/transport.unit.test.ts` (contenido del correo, caducidad en minutos u horas, límites de la variable) y `apps/api/src/auth/password-reset.integration.test.ts`, contra la instancia real de Better Auth: la capa de correo recibe el enlace, la respuesta es la misma exista o no la cuenta, `sendResetPassword` está configurado y la contraseña de siempre sigue valiendo si no se usa el enlace.

## Adenda 2026-11-10 — revisión de la recuperación (#551)

* **El envío no se espera.** Better Auth solo llama a `sendResetPassword` si la cuenta existe; esperar al SMTP hacía que el tiempo de respuesta delatara qué correos están registrados. Se lanza sin `await` y un fallo se registra en el log. Con eso la respuesta es la misma exista o no la cuenta, y el cliente ya puede contar un error del servidor como fallo (antes devolvía `ok` y la pantalla decía «enviado» aunque no se mandara nada).
* **Restablecer cierra todas las sesiones** (`revokeSessionsOnPasswordReset: true`): quien lo hace suele temer que otro tenga la contraseña vieja.
* **Sin transporte de correo no hay recuperación.** En producción sin `SMTP_HOST` no se configura `sendResetPassword`, `/api/v1/config` devuelve `emailDeliveryEnabled: false` y el acceso esconde el enlace. Se descarta exigir SMTP al arrancar: la imagen corre con `NODE_ENV=production` y el `docker-compose.yml` no trae SMTP, así que tumbaría despliegues que hoy funcionan.
* La URL de retorno se construye con `url()`: respeta la ruta base y el prefijo de idioma.
