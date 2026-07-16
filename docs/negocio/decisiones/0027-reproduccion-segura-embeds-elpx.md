# ADR-0027 Reproducción segura de vídeos/PDF embebidos en `.elpx` (promote-to-parent con player en modal)

* Estado: Supersedido por [ADR-0031](0031-migracion-bridge-medios-compartido-exelearning.md)
* Fecha: 2026-06-14
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/interoperabilidad-educativa, @.agents/skills/qa-validacion]

## Contexto y Problema

La [ADR-0026](0026-apertura-segura-elpx.md) sirve el contenido del `.elpx` con **origen opaco** (sandbox sin `allow-same-origin`). Efecto colateral: el conjunto de flags del sandbox **se hereda por los iframes anidados**. Por tanto, los embeds que el autor mete dentro del `.elpx` (YouTube, Vimeo, el visor de PDF…) heredan el origen opaco: su JavaScript de player queda con origen `null` y no puede acceder a las cookies/almacenamiento de su propio origen, así que salen en blanco o rotos.

Verificado con el fixture `remote-embeds.elpx` (incluido en este PR), que contiene cuatro casos reales:
* `https://www.youtube.com/embed/aqz-KE-bpKQ` — roto en origen opaco.
* `https://player.vimeo.com/video/76979871` — roto en origen opaco.
* `https://mediateca.educa.madrid.org/video/...` — **funciona** (su embed no depende de su propio origen).
* `https://mozilla.github.io/.../*.pdf` — el visor nativo de PDF tampoco funciona sandboxed.

Queremos reproducir esos vídeos y PDFs **sin reintroducir `allow-same-origin`** en el contenido del autor (para que su JS no pueda escapar de Procomún).

## Valoración del enfoque de `mod_exelearning` (referencia)

El plugin de Moodle resuelve esto (su ADR DEC-0061) con un patrón **promote-to-parent**: un *shim* dentro del iframe detecta los embeds y los sustituye por placeholders, y un *relay* en el padre los re-renderiza como players de confianza **superpuestos inline**, sincronizando su posición de forma continua (scroll/resize/MutationObserver), con whitelist y modos open/strict. Es **robusto y seguro** (preserva el origen opaco; el player se carga en el origen real del proveedor, aislado por la Same-Origin Policy), pero su complejidad viene del overlay posicionado con sincronización continua de geometría.

## Opciones Consideradas

* **Opción 1 — No hacer nada:** los embeds de vídeo/PDF quedan rotos en las vistas previa. Descartada: degrada el valor pedagógico.
* **Opción 2 — Promote-to-parent con player en modal (elegida):** mismo modelo de seguridad que `mod_exelearning` pero más simple. El shim sustituye el embed por una **fachada clicable**; al pulsar, Procomún abre el contenido en un player de confianza en un **modal/lightbox** del frame principal. Al ser click→modal, no hace falta sincronizar geometría.
* **Opción 3 — Origen separado sin cookies:** servir los `.elpx` desde un subdominio/origen distinto sin cookies de sesión y quitar el sandbox; los embeds funcionarían nativos sin shim ni modal. Es lo más simple en código, pero requiere cambio de infraestructura (DNS/TLS/routing/CORS) fuera de este PR. Se registra como **evolución futura** preferente a largo plazo.

## Decisión

Se adopta la **Opción 2**. Tres piezas:

1. **Shim** (`apps/api/static/elpx/embed-shim.js`), inyectado por `elpx-content.ts` en el HTML servido del `.elpx`. Corre dentro del iframe opaco (se activa solo en origen opaco), detecta de forma *coarse* iframes cross-origin https o `.pdf`, los sustituye por una fachada clicable y, al pulsar, hace `postMessage({ source:'procomun-elpx-embed', action:'play', url }, '*')` al padre.
2. **Política de embeds** (`apps/frontend/src/lib/elpx-embed-policy.ts`, núcleo de seguridad) — `classifyEmbed` valida autoritativamente: rechaza userinfo y no-https; `.pdf` → `pdf`; cross-origin https → `video`; canonicaliza proveedores conocidos (YouTube → youtube-nocookie). **Modo abierto**: cualquier iframe https cross-origin se promociona.
3. **Relay + modal** (`apps/frontend/src/hooks/use-elpx-embed-relay.ts` + `apps/frontend/src/islands/catalog/EmbedModal.tsx`, reusa `Dialog.tsx`) — escucha `message`, **autentica por identidad de ventana** (`event.source === iframe.contentWindow`; en origen opaco `event.origin` es `null`), valida con `classifyEmbed` y abre el player en un modal.

**Invariante crítico:** un embed de tipo vídeo solo se promociona si es **cross-origin https**; nunca same-origin. Así, una URL maliciosa al propio origen no puede cargarse con `allow-same-origin` en el modal y escapar del aislamiento. El player del proveedor lleva `allow-same-origin` para SU propio origen (p.ej. youtube.com), aislado de Procomún por la Same-Origin Policy.

## Consecuencias

### Positivas
* Vídeos (YouTube/Vimeo/Mediateca…) y PDF se reproducen en un player de confianza **sin perder el origen opaco** del contenido del autor.
* El JS del autor nunca obtiene el origen de Procomún.
* Más simple que el overlay inline de `mod_exelearning` (no sincroniza geometría); reutiliza el `Dialog` accesible existente.
* Canonicalización a `youtube-nocookie` como mejora de privacidad.

### Negativas / Riesgos
* El iDevice de "vídeo interactivo" (JS del autor que controla el player por API) **no funciona** en origen opaco: el vídeo se promociona pero el JS del autor no puede controlarlo. Misma limitación documentada que `mod_exelearning`; alternativa: vídeo local (`<video>`).
* En modo abierto se promociona cualquier iframe https cross-origin; si se quisiera restringir, existe el helper de canonicalización por proveedor para un modo estricto futuro.
* Las miniaturas de las tarjetas reciben el shim (muestran fachada en vez de embed roto) pero no montan modal: el click allí se ignora.
* Pendiente (follow-up): emitir `Permissions-Policy` restrictiva al servir el contenido para denegar cámara/GPS/etc. al iframe.

## Carga de los recursos propios del paquete bajo origen opaco (CORS)

Bajo el origen opaco, el documento del `.elpx` tiene `origin = "null"`, por lo que **sus propios subrecursos** (scripts del paquete y el shim) se piden como **cross-origin** (`Origin: null`). Para que se carguen correctamente:

* La API sirve el contenido del `.elpx` con `Access-Control-Allow-Origin: *` (es contenido público y, además, embebible cross-origin: existe la función "Ponlo en tu web").
* En el HTML servido se añade `crossorigin="anonymous"` a los `<script src="/api/v1/elpx/...">` propios (incluido el shim), para que se carguen en modo CORS.

Sin esto, los scripts clásicos del paquete fallan en el **dev server de Vite**, que bloquea peticiones cross-origin no-cors a scripts (`[Vite] Cross-origin requests for classic scripts must be made with CORS mode enabled`). Verificado en navegador: con `crossorigin` + ACAO, los scripts del `.elpx` cargan, el shim promociona el embed a una fachada y el modal reproduce el vídeo de YouTube (youtube-nocookie). El render directo por la API (producción, sin Vite) ya funcionaba; el `crossorigin`/ACAO es además correcto para el caso de incrustación en terceros.

## Notas de Implementación

* Puntos de extensión: el shim (`embed-shim.js`), `classifyEmbed` (allowlist/canonicalización) y `EmbedModal` (players).
* El relay se monta en `ResourceDetailIsland` (ficha pública, superficie principal de consumo, cuyo preview se sirve vía `elpx-content`). `EditarPage` queda fuera si su preview es un blob cliente sin shim.
* Validación (regla 14): tests en `elpx-embed-policy.unit.test.ts` (incl. drive sobre los 4 embeds reales de `remote-embeds.elpx`), `use-elpx-embed-relay.unit.test.ts` (autenticación por identidad + invariante), `EmbedModal.unit.test.tsx` (ramas vídeo/PDF) y aserción de inyección del shim en `elpx-processor.unit.test.ts`. El cuerpo del hook React (glue de DOM) no es ejercitable sin navegador; la lógica de seguridad está al 100%.
* Evolución futura preferente: Opción 3 (origen separado sin cookies), que eliminaría el shim/relay/modal.
