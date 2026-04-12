# Validation — Épica 002: subidas resumibles y adjuntos

## Validación automatizada

- `cd apps/api && bun test ./src/routes/admin.unit.test.ts ./src/routes/uploads.unit.test.ts ./src/uploads/config.unit.test.ts`
- `cd apps/frontend && bun run build`
- `env -u DATABASE_URL bun run check-coverage`

## Resultado esperado

- uploads resumables funcionales para usuarios author+
- creación de `media_items` al finalizar
- cancelación de uploads incompletos
- cobertura global del repositorio >= 90%

## Actualización 2026-04-12 — validación prevista tras aceptación de ADR-0020

La validación mínima de implementación deberá incluir:

- tests unitarios del clasificador de adjuntos homogéneos por MIME/type
- tests de generación para:
  - una imagen
  - varias imágenes
  - un audio
  - varios audios
  - un vídeo
  - varios vídeos
  - mezcla de tipos con fallback genérico
- verificación automatizada de que el `.elpx` resultante sigue siendo compatible con `processElpxUpload`
- verificación automatizada de que los `media_items` conservan URLs directas funcionales tras regenerar el `.elpx`
