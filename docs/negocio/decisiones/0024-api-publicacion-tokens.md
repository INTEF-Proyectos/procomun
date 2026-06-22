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
