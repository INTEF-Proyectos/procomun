# ADR-0029 Migración al bridge de medios externos compartido de eXeLearning (paridad con `mod_exelearning`)

* Estado: Aceptado
* Fecha: 2026-06-29
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/interoperabilidad-educativa, @.agents/skills/qa-validacion]

## Contexto y Problema

La [ADR-0026](0026-apertura-segura-elpx.md) sirve el contenido del `.elpx` con **origen opaco** (sandbox sin `allow-same-origin`), y la [ADR-0027](0027-reproduccion-segura-embeds-elpx.md) resolvió el efecto colateral de que los embeds anidados (YouTube/Vimeo/PDF) hereden ese origen opaco y salgan en blanco, con un mecanismo **propio de Procomún**: shim → `postMessage` → **modal/lightbox** (`use-elpx-embed-relay.ts` + `elpx-embed-policy.ts` + `EmbedModal.tsx`).

Ese mecanismo funciona pero es una **implementación divergente** del problema que el resto de la familia eXeLearning ya resuelve con un bridge común. Desde que se escribió la ADR-0027, ese bridge se ha consolidado como **código canónico en `mod_exelearning`** (decisiones DEC-0059/DEC-0061/DEC-0067 del plugin de Moodle) y se ha espejado en `wp-exelearning` y `omeka-s-exelearning`, con un comprobador anti-drift (`tools/check-embed-sync.mjs`) que mantiene los tres en sincronía. El modal propio de Procomún quedaba fuera de esa convergencia y, además, le faltaban varias protecciones y funciones que el bridge canónico ya incorpora.

El problema a decidir es **si mantener el mecanismo propio o alinear Procomún con el bridge compartido** para obtener paridad total con el resto de integraciones y dejar de mantener una variante aislada.

### De dónde viene el bridge (procedencia / fuente única de verdad)

* La **lógica canónica** vive en `mod_exelearning` (`js/exe_embed_shim.js`, `js/exe_embed_relay.js`, `js/exe_media_host.js`, `js/exe_media_policy.js`). `wp-exelearning` y `omeka-s-exelearning` mantienen **espejos en JS plano** verificados por `check-embed-sync.mjs`. Procomún (TypeScript/Bun) no puede ser un espejo verificado por ese script, así que **vendoriza** esos ficheros JS tal cual y los carga como assets estáticos.
* El **runtime hijo** (`exe_media_bridge.js`), que corre *dentro* del iframe del paquete, lo **hornea el editor de eXeLearning** dentro de cada `.elpx` en la exportación. Por eso Procomún **solo necesita el lado del padre** (shim de contenido + relay + media host + policy); no reimplementa nada del lado hijo.

### Dos problemas ortogonales que el bridge separa explícitamente

* **A — Propagación del sandbox (origen opaco).** El `sandbox` sin `allow-same-origin` del contenido se hereda por el iframe anidado del player → pierde su origen real y queda en blanco. Lo arregla **solo** promoverlo al padre de confianza (promote-to-parent). `referrerpolicy` **no** lo arregla.
* **B — "Error 153" / referrer.** Independiente del sandbox: el player de YouTube devuelve `embedder.identity.missing.referrer` cuando no puede leer el `Referer` (p.ej. si la página envía `Referrer-Policy: no-referrer` o el iframe no lleva `referrerpolicy`). Lo arregla el atributo `referrerpolicy="strict-origin-when-cross-origin"` **por iframe**, que anula la política de la página.

## Opciones Consideradas

* **Opción 1 — Mantener el modal propio (ADR-0027):** seguir con `use-elpx-embed-relay.ts` + `EmbedModal.tsx`. Descartada: nos deja como variante aislada, sin las protecciones nuevas (canal id-only, D1/D2), sin vídeo interactivo y sin canonicalización de Vimeo, y duplica el esfuerzo de mantenimiento frente al bridge canónico.
* **Opción 2 — Adoptar el bridge compartido con paridad total (elegida):** retirar el mecanismo propio y vendorizar el bridge canónico de `mod_exelearning` (shim de contenido + relay + media host + policy), recableando la ficha pública para usarlo.
* **Opción 3 — Origen separado sin cookies:** la evolución futura preferente que ya anotaban ADR-0026/0027 (servir el `.elpx` desde un origen sin cookies y quitar el sandbox), que eliminaría shim/relay por completo. Requiere cambio de infraestructura (DNS/TLS/CORS) y queda fuera de este PR; se mantiene como horizonte a largo plazo.

## Decisión

Se adopta la **Opción 2**. Se sustituye el manejo propio de medios externos por el **bridge de medios externos compartido de eXeLearning**, logrando paridad con `mod_exelearning`, `wp-exelearning` y `omeka-s-exelearning`. Esta decisión **supersede a la ADR-0027**.

Piezas:

1. **Shim de contenido** (`apps/api/static/elpx/embed-shim.js`) — réplica del canónico de `mod_exelearning`; corre dentro del iframe opaco, detecta embeds candidatos (cross-origin https o `.pdf`), los sustituye por un placeholder que reserva su caja y reporta su geometría al padre. Para proveedores reconocidos envía **solo `{provider, objectId}`** (canal id-only), nunca la URL del autor.
2. **Política compartida** (`apps/frontend/public/elpx/exe_media_policy.js`) — detección/normalización de proveedor, canonicalización de URL y validación de mensajes; fuente única de verdad de la política.
3. **Relay del padre** (`apps/frontend/public/elpx/exe_embed_relay.js`) — escucha mensajes, **autentica por identidad de ventana** (`event.source === iframe.contentWindow`; bajo origen opaco `event.origin` es `null` e inútil), reconstruye la URL canónica desde una **plantilla fija por proveedor** (`youtube-nocookie.com/embed/{id}`, `player.vimeo.com/video/{id}`) con regex estricta (anti redirect-laundering) y superpone el player en un **overlay inline clampado a la caja del contenido** (no un modal aparte).
4. **Media host** (`apps/frontend/public/elpx/exe_media_host.js`) — da soporte al iDevice de **vídeo interactivo** retransmitiendo control (play/pause/seek/tiempo) por `postMessage` **crudo** (`enablejsapi=1` en YouTube, `api=1` en Vimeo), **sin** cargar la YouTube IFrame API ni el Vimeo SDK en la página.
5. **Recableado** (`apps/frontend/src/islands/catalog/ResourceDetailIsland.tsx`) — carga `exe_media_policy.js` → `exe_embed_relay.js` → `exe_media_host.js` (el orden importa: el host lee `window.exeMediaPolicy`), llama a `window.exeEmbedRelay.init({ mode: 'open' })` y `window.exeMediaHost.attach(previewIframe)`, con limpieza (detach) al desmontar. Se eliminan `use-elpx-embed-relay.ts`, `elpx-embed-policy.ts` y `EmbedModal.tsx` (y sus tests).

**El nonce no es autenticación.** El bridge histórico minteaba un nonce por vista; aquí se descarta como mecanismo de confianza: un iframe **opaco no confiable** recibiría ese mismo nonce, así que no prueba nada. La confianza real es la **identidad de ventana** (`event.source`, que el navegador no permite falsificar) más la **posesión del `MessagePort`** transferido en el handshake. Esto coincide con la corrección registrada en `mod_exelearning` (DEC-0067).

**Invariantes de seguridad preservados** (heredados de ADR-0026/0027 y del bridge canónico):
* El iframe de contenido del autor sigue **opaco** (sin `allow-same-origin`); el JS del autor nunca obtiene el origen de Procomún.
* Un embed de vídeo solo se promociona si es **cross-origin https**; el player promovido lleva `allow-same-origin` **para SU propio origen** (p.ej. youtube), aislado de Procomún por la Same-Origin Policy, y **sin** `allow-top-navigation`.
* Los PDF se promocionan (cross-origin https `.pdf`, o fichero same-origin del propio paquete servido como `application/pdf` + `nosniff`), con sandbox sin `allow-same-origin` y `referrerpolicy: no-referrer`.
* Defensas adicionales del relay: validación de invariante estructural, **D1** (guarda de redirección a same-origin) y **D2** (defensa de mensaje forjado).
* `referrerpolicy="strict-origin-when-cross-origin"` en el player de vídeo (Problema B).

## Consecuencias

### Positivas

* **Paridad total** con `mod_exelearning`/`wp`/`omeka`: una sola lógica, mismas garantías, mismas correcciones. Se deja de mantener una variante propia.
* Gana frente al modal anterior: **canonicalización de Vimeo** (antes solo YouTube), **canal id-only** (la URL del autor no cruza para proveedores reconocidos), **D1/D2**, **overlay inline** clampado (defensa anti-clickjacking acotada a la caja) y **soporte de vídeo interactivo** (antes no funcionaba en origen opaco — limitación que ADR-0027 documentaba explícitamente).
* No se carga la YouTube IFrame API ni el Vimeo SDK en la página del frontend: el control va por `postMessage` crudo.
* El origen opaco del contenido y la CSP **no cambian**: se preserva el aislamiento de ADR-0026.

### Negativas / Riesgos

* Procomún **no puede** ser un espejo verificado por `check-embed-sync.mjs` (es TS, no JS plano): los cuatro ficheros vendorizados se **sincronizan a mano** desde `mod_exelearning` cuando cambie el canónico. Mitigación: cada fichero lleva cabecera indicando su procedencia; el `node --check` cubre la integridad sintáctica.
* El media host depende del contrato del runtime hijo (`exe_media_bridge.js`) que hornea el editor de eXeLearning; un cambio incompatible de ese contrato requeriría re-sincronizar.
* En modo `open` (por defecto) se promociona cualquier iframe https cross-origin; el modo `strict` por proveedor queda disponible para endurecer si se necesitara.

## Notas de Implementación

* Puntos de extensión: los cuatro ficheros vendorizados en `apps/frontend/public/elpx/` (+ `apps/api/static/elpx/embed-shim.js`) y el montaje en `ResourceDetailIsland.tsx`. La fuente de verdad para actualizarlos es `mod_exelearning` (`js/exe_*`).
* Validación (regla 14): la suite completa queda en verde (681 pass / 0 fail) y se actualiza `elpx-processor.unit.test.ts` para la inyección del shim canónico; `node --check` sobre los cuatro ficheros JS vendorizados. La lógica de DOM del overlay/host (glue de navegador) no es ejercitable sin navegador; su política sí está cubierta por los tests de la fuente canónica.
* Evolución futura preferente (sin cambios respecto a ADR-0026/0027): la Opción 3 (origen separado sin cookies) eliminaría shim/relay/host por completo.
* Nota de despliegue: para robustez de YouTube/Vimeo, servir `Referrer-Policy: strict-origin-when-cross-origin` en las páginas que embeben contenido eXe; los vídeos de Vimeo restringidos por dominio requieren que el dominio del frontend esté en su lista blanca (el player corre en el origen real del frontend).
