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

## Actualización 2026-05-25 — resultado issue #160 / DEF-009

- `bun test apps/frontend/src/pages/NuevoPage.unit.test.tsx apps/frontend/src/islands/resources/ResourceForms.unit.test.tsx` ✅
- `bun test` ✅ (`429 pass`, `0 fail`)

### Observaciones
- La corrección cubre el flujo de alta manual con `.elpx` en `NuevoPage`, donde el análisis sí devolvía metadatos pero estos se perdían al intentar escribirlos sobre nodos todavía no montados.
