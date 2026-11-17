# ADR-0024 API de publicación de recursos con autenticación por token

* Estado: Aceptado
* Fecha: 2026-05-26
* Agentes Implicados: [@.agents/skills/backend-api-servicios, @.agents/skills/seguridad-privacidad-legal]

## Contexto y Problema

No existe una forma programática de publicar recursos desde aplicaciones externas. La ingesta de recursos depende actualmente de la interfaz editorial interna (panel admin con sesión de cookies), lo que impide integración con herramientas de autor, otros repositorios educativos, plataformas LMS y scripts de migración.

Se necesita un mecanismo de autenticación adecuado para APIs machine-to-machine que no dependa de sesiones de navegador.

## Opciones Consideradas

* **Opción 1: OAuth2 Client Credentials** — Estándar para machine-to-machine, pero requiere servidor OAuth2 completo y es complejo para usuarios individuales que quieren un token rápido.
* **Opción 2: API Keys/Tokens propios (Bearer tokens hasheados)** — Cada usuario genera tokens desde su perfil, se almacenan como SHA-256 hashes. Simple, seguro y autocontenido.
* **Opción 3: Reutilizar sesiones de Better Auth con tokens de larga duración** — Mezcla sesiones de navegador con acceso programático, dificulta la revocación individual y la auditoría.

## Decisión

**Opción 2: API tokens propios con Bearer auth y SHA-256 hashing.**

Justificación:
- Simplicidad de implementación y uso para el desarrollador externo.
- Control total: el usuario crea, nombra y revoca tokens individualmente.
- El token se muestra solo una vez (solo se almacena el hash).
- Rate limiting y logging por token para auditoría ENS.
- No requiere infraestructura OAuth2 adicional.
- Patrón probado (GitHub, GitLab, npm, etc.).

## Consecuencias

### Positivas
* Los usuarios pueden integrar cualquier herramienta externa de forma segura.
* Los tokens son revocables individualmente sin afectar otras sesiones.
* La auditoría por token es sencilla (cada token tiene contador de uso).
* Compatible con el flujo editorial existente (los recursos entran como draft/review).
* Rate limiting protege contra abuso.

### Negativas / Riesgos
* El token es un secreto que el usuario debe custodiar; si se filtra, hay que revocarlo manualmente.
* No hay rotación automática (podría añadirse en el futuro con expiración obligatoria).
* El rate limiting es in-memory; en multi-instancia se necesitaría Redis o similar.

## Notas de Implementación

1. Tabla `api_tokens` con hash SHA-256 del token, prefijo visible, user_id, nombre, timestamps.
2. Endpoints de gestión de tokens bajo `/api/v1/tokens` (requieren sesión activa).
3. Endpoints de publicación bajo `/api/v1/publish/resources` (requieren Bearer token).
4. Middleware `tokenAuthMiddleware` que valida el token y carga el usuario en contexto.
5. Rate limit: 100 peticiones/minuto por token (in-memory).
6. Los recursos creados vía API entran en flujo editorial con estado configurable (draft o review).

## Adenda 2026-11-04 — rol mínimo `author` para crear claves y publicar (#537)

**Problema.** Esta ADR no fijó rol mínimo, y la implementación solo exigía estar autenticado: `POST /api/v1/tokens` detrás de `requireAuth` y `POST /api/v1/publish/resources` comprobando únicamente que hubiera usuario en contexto. Una cuenta `reader`, que en la interfaz no puede crear recursos (`NuevoPage` lo bloquea y la pestaña de claves se oculta con `hasMinRole(user.role, "author")`), podía crearse una clave de API y crear recursos en borrador o en revisión. Modificar y borrar no estaban afectados: ya pasaban por `canManageResource`, que exige `author` o superior.

**Decisión.** Las dos rutas de creación exigen rol mínimo `author`, con el middleware `requireRole` que ya aplica la jerarquía de `ROLE_LEVELS`. La regla del servidor queda igual que la de la interfaz.

- `POST /api/v1/tokens` → 403 «Permisos insuficientes» con rol `reader` o sin rol.
- `POST /api/v1/publish/resources` → 403, también cuando se pide `editorialStatus: "review"`.
- `GET` y `DELETE /api/v1/tokens` **no** lo exigen: quien creó claves antes de esta regla tiene que poder listarlas y revocarlas.

**Claves ya creadas por cuentas `reader`.** No se revocan en masa. Dejan de servir para publicar en cuanto se usan (403) y su dueño puede revocarlas desde su perfil. Revocarlas de oficio exigiría un comando y un criterio sobre cuentas que entretanto hayan cambiado de rol; con #525 las cuentas nuevas nacen como `editor`, así que el caso se limita a cuentas puestas en `reader` a mano.

**Validación.** `apps/api/src/routes/api-tokens.unit.test.ts` y `apps/api/src/routes/api-resources.unit.test.ts`, bloques «rol mínimo (#537)»: rojo → verde con `reader` y sin rol, verde de `author` a `admin`, y listar y revocar siguen abiertos.
