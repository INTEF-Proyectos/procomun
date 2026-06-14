# Diseño — Apertura segura de archivos `.elpx`

* Fecha: 2026-06-14
* ADR: [ADR-0026](../../negocio/decisiones/0026-apertura-segura-elpx.md)

## A. Extracción endurecida

Nuevo módulo `apps/api/src/services/elpx-safe-extract.ts`.

### Flujo de `safeExtractElpx(filePath, extractPath, limits?)`
1. Leer los bytes del `.elpx`.
2. `inspectZipEntries(buf, limits)` — **antes de tocar el disco**:
   * `readZipCentralDirectory(buf)` localiza el End-Of-Central-Directory y recorre las cabeceras del directorio central (`PK\x01\x02`), extrayendo por entrada: nombre, tamaño comprimido, tamaño descomprimido y si es symlink (modo Unix `S_IFLNK` en los 16 bits altos de los atributos externos cuando el host es Unix). ZIP64 → fail-closed.
   * Por cada entrada: `isUnsafeZipEntry(name)` (traversal/absoluta/backslash/esquema/vacío) y rechazo de symlinks.
   * Límites: `maxEntries`, `maxTotalUncompressed`, `maxCompressionRatio` (`DEFAULT_ELPX_EXTRACT_LIMITS`).
3. Extraer con `unzip -o`.
4. `assertExtractionContained(extractPath)` — recorre el árbol, rechaza symlinks (`lstat`) y verifica con `realpath` que cada ruta queda dentro del destino.
5. `try/catch` global: ante cualquier fallo, `rm -rf extractPath` (rollback) y re-lanzar.

`processElpxUpload` (`elpx-processor.ts`) sustituye el `Bun.spawn(["unzip", ...])` directo por `safeExtractElpx`. El contrato `ElpxProcessResult` no cambia.

### Decisiones de diseño
* **Parseo propio del directorio central** en vez de parsear texto de `unzip -l`: robusto, independiente de locale, y permite detectar symlinks y tamaños sin descomprimir.
* **Doble defensa** (pre-inspección + contención post-extracción), igual que el plugin Moodle.
* **Sin dependencias nuevas**: se mantiene `unzip` del sistema.

## B. Renderizado con origen opaco

### Servidor — `apps/api/src/routes/elpx-content.ts`
A la CSP de las respuestas HTML se añade:
```
sandbox allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox
```
Sin `allow-same-origin`. La directiva `sandbox` en la CSP fuerza origen opaco incluso si el `.elpx` se abre directamente (no solo embebido).

### Cliente — iframes de preview
Se retira `allow-same-origin` de los iframes que muestran contenido de autor:
`ResourceCard.tsx`, `HomeDataIsland.tsx`, `CatalogIsland.tsx`, `PublicCollectionsIsland.tsx`, `catalog-controller.ts`, `ResourceDetailIsland.tsx` (preview) y `EditarPage.tsx` (preview). Se conserva `allow-scripts` para la interactividad.

### Excepción consciente
El iframe del **editor eXeLearning** (`editorUrl`/`iframeRef` en `ResourceDetailIsland.tsx`) es código first-party y usa un puente `postMessage` para exportar; no se sandboxea con origen opaco. Al no haber SCORM, ningún preview necesita ese puente.

## Por qué "no hay SCORM" simplifica
En Moodle, el tracking SCORM exige un puente `postMessage` same-origin entre el contenido y el LMS, lo que dificulta el origen opaco. Procomún no hace tracking SCORM en el render, así que los previews pueden ser opacos sin perder funcionalidad.

## C. Reproducción de embeds (vídeos/PDF) — addendum (ADR-0027)
El origen opaco se hereda por los iframes anidados, así que los embeds de YouTube/Vimeo/PDF del autor se rompen. Solución **promote-to-parent** simplificada (fachada + player en modal), sin reintroducir `allow-same-origin` en el contenido:
- **Shim** `apps/api/static/elpx/embed-shim.js`, inyectado por `elpx-content.ts`: dentro del iframe opaco sustituye los embeds por una fachada clicable que hace `postMessage` al padre.
- **Política** `apps/frontend/src/lib/elpx-embed-policy.ts` (`classifyEmbed`): valida (rechaza userinfo/no-https y **vídeo same-origin**), canonicaliza proveedores conocidos. Modo abierto.
- **Relay + modal** `apps/frontend/src/hooks/use-elpx-embed-relay.ts` + `apps/frontend/src/islands/catalog/EmbedModal.tsx` (reusa `Dialog.tsx`), montado en `ResourceDetailIsland`. Autentica por identidad de ventana. El player carga la URL del proveedor con su propio origen, aislado por SOP.
