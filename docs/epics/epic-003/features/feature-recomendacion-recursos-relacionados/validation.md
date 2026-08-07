# Validation — Recursos relacionados

* Issue: #72
* Fecha: 2026-08-06

## Automatizada

1. `bun test apps/api/src/recommendations/` — score y servicio.
2. Suite global `bun test` / CI `build` + tests unitarios.
3. Sin `expect(true)` / asserts vacuos: cada test fija valores numéricos de score u orden de slugs.

## Manual (smoke)

1. Publicar al menos 3 recursos con materias/niveles solapados.
2. Abrir ficha del primero → ver sección “Recursos relacionados”.
3. Confirmar que no aparece el propio recurso ni drafts.
4. Si dos recursos comparten `createdBy` o `author`, comprobar “Más del mismo autor”.
