# Validación — Apertura segura de archivos `.elpx`

* Fecha: 2026-06-14
* ADR: [ADR-0026](../../negocio/decisiones/0026-apertura-segura-elpx.md)

## Pruebas automatizadas

Nuevo: `apps/api/src/services/elpx-safe-extract.unit.test.ts` (20 tests). Cubre:

| Requisito | Caso de prueba | Resultado |
|-----------|----------------|-----------|
| R1.1 zip slip | `isUnsafeZipEntry` acepta normales / rechaza `..`, `/abs`, `a\b`, `scheme://`, vacío | ✅ |
| R1.1 zip slip | `inspectZipEntries` rechaza entrada `../evil.txt` | ✅ |
| R1.2 symlink | `readZipCentralDirectory` detecta symlink por modo Unix; `inspectZipEntries` lo rechaza | ✅ |
| R1.2 symlink | `assertExtractionContained` rechaza symlink en el árbol extraído | ✅ |
| R1.3 zip bomb | rechazo por nº de entradas, por tamaño descomprimido y por ratio de compresión | ✅ |
| R1.4 contención | `assertExtractionContained` acepta árbol normal | ✅ |
| R1.5 rollback | `safeExtractElpx` con zip slip lanza error, borra destino y no escribe en el padre | ✅ |
| R1 (feliz) | `safeExtractElpx` extrae un `.elpx` válido | ✅ |
| R2.1 origen opaco | `elpx-processor.unit.test.ts`: la CSP del HTML contiene `sandbox` + `allow-scripts` y NO `allow-same-origin` | ✅ |

## Evidencia de ejecución

```
bun run check-test-files
→ All tracked TypeScript source files have an accepted test file.

bun test (elpx-safe-extract + elpx-processor + elpx-fixtures + elpx-generator)
→ 72 pass, 0 fail, 285 expect() calls

bun run test:unit (suite completa)
→ 484 pass, 0 fail, 1415 expect() calls — 59 files

bun run check-coverage
→ Coverage de líneas: 90.46% ✅ (>= 90%)
   apps/api/src/services/elpx-safe-extract.ts → 100.00% líneas
   apps/api/src/services/elpx-processor.ts    → 100.00% líneas

bun run lint (biome)
→ sin incidencias
```

## Verificación manual sugerida

1. `bun run dev:api` y subir un `.elpx` legítimo: se extrae y se sirve igual que antes.
2. `curl -I http://localhost:PORT/api/v1/elpx/{hash}/index.html` → la cabecera `Content-Security-Policy` incluye `... sandbox allow-scripts ...` sin `allow-same-origin`.
3. En el navegador, abrir un preview y comprobar en DevTools que el documento del iframe reporta origen `null` (opaco), manteniendo la interactividad del contenido.

## Embeds (vídeos/PDF) — addendum (ADR-0027)

```
bun test elpx-embed-policy.unit.test.ts        → política sobre los 4 embeds reales de remote-embeds.elpx
bun test use-elpx-embed-relay.unit.test.ts     → autenticación por identidad + invariante same-origin
bun test EmbedModal.unit.test.tsx              → ramas vídeo/PDF del player
bun test elpx-processor.unit.test.ts           → inyección del shim antes de </head> + ruta /embed-shim.js
bun run test:unit                              → 509 pass, 0 fail
bun run check-coverage                         → 90.13% ✅; elpx-embed-policy.ts 100% líneas
```

Verificación manual sugerida: abrir la ficha de un recurso `remote-embeds.elpx`; el embed aparece como fachada; al pulsar se abre el modal y el vídeo de YouTube reproduce; en DevTools el documento del `.elpx` sigue con origen `null`.

## Estado

Requisitos R1.1–R1.5, R2.1–R2.4 y R3.1–R3.2 (extracción + origen opaco) y reproducción segura de embeds (ADR-0027): **cumplidos** y validados con `bun test` en verde.
