# ADR-0026 Apertura segura de archivos `.elpx` (extracción endurecida y renderizado con origen opaco)

* Estado: Aceptado
* Fecha: 2026-06-14
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/backend-api-servicios, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/qa-validacion]

## Contexto y Problema

Un archivo `.elpx` es un paquete ZIP de eXeLearning que contiene HTML, JavaScript, CSS y recursos producidos por el autor del contenido. En Procomún ese contenido es **no confiable**: cualquier persona con permiso de creación puede subir un `.elpx`, y cualquier visitante lo verá. Al revisar el flujo actual frente al análisis de `articulo-seguridad-exelearning` (cuya tesis es que el riesgo no es ejecutar JavaScript de autor, sino ejecutarlo **con el mismo origen autenticado** de la plataforma) y a la implementación de referencia del plugin Moodle `mod_exelearning` (`classes/local/zip_utils.php`), se detectaron dos problemas:

**A. Extracción/apertura insegura del ZIP.** `processElpxUpload` (`apps/api/src/services/elpx-processor.ts`) extraía con `unzip` directo, sin defensa propia:
* Sin validación de nombres de entrada → **zip slip / path traversal** (`../../etc/...`, rutas absolutas, esquemas `file://`).
* Sin rechazo de **symlinks** maliciosos (un enlace dentro del archivo puede convertir escrituras/lecturas posteriores en operaciones de ruta arbitraria).
* Sin límites de **tamaño descomprimido, número de entradas ni ratio de compresión** → **zip bomb** / agotamiento de disco.

**B. Ejecución del contenido de autor con origen real.** La respuesta HTML del `.elpx` (`apps/api/src/routes/elpx-content.ts`) no incluía la directiva `sandbox` en su CSP, y el frontend embebía las vistas previas con `sandbox="allow-scripts allow-same-origin"` en múltiples sitios. La combinación `allow-scripts` + `allow-same-origin` **anula el sandbox**: el JavaScript del autor se ejecuta con el origen real, donde residen las cookies de sesión de `better-auth`, abriendo la puerta a acciones autenticadas en nombre del visitante.

A diferencia de Moodle, Procomún **no realiza tracking SCORM en el render**, por lo que no necesita el puente `postMessage` same-origin que en aquel caso complica el aislamiento. Esto simplifica la mitigación del renderizado a **origen opaco directo**.

## Opciones Consideradas

* **Opción 1 — Mantener el estado actual:** confiar en el `unzip` del sistema y en los iframes con `allow-same-origin`. Descartada: deja abiertos zip slip, symlink, zip bomb y ejecución same-origin.
* **Opción 2 — Defensa en profundidad (elegida):** endurecer la extracción (validación de entradas, rechazo de symlinks, límites anti zip-bomb, contención post-extracción) **y** aislar el renderizado con origen opaco (directiva `sandbox` en la CSP servida + retirada de `allow-same-origin` de los iframes de preview).
* **Opción 3 — Sustituir `unzip` por un descompresor JavaScript puro (p. ej. `fflate`):** daría control total del proceso de inflado sin lanzar subprocesos. Anotada como posible evolución futura; por ahora se mantiene `unzip` precedido de inspección propia del directorio central del ZIP para no introducir dependencias nuevas.

## Decisión

Se adopta la **Opción 2** (defensa en profundidad A + B).

**A. Extracción endurecida.** Nuevo módulo `apps/api/src/services/elpx-safe-extract.ts`:
* `isUnsafeZipEntry(name)` — port de `zip_utils.php::is_unsafe_zip_entry`: rechaza nombre vacío, backslash, ruta absoluta, esquema `scheme://` y traversal `..`.
* `readZipCentralDirectory` / `inspectZipEntries` — leen el **directorio central del ZIP** (sin descomprimir) para validar nombres, detectar symlinks por el modo Unix de los atributos externos y aplicar límites (`maxEntries`, `maxTotalUncompressed`, `maxCompressionRatio`) **antes** de tocar el disco.
* `assertExtractionContained(dir)` — port de `assert_extraction_contained`: tras extraer, recorre el árbol, rechaza cualquier symlink y verifica con `realpath` que todo quedó dentro del destino.
* `safeExtractElpx(filePath, extractPath)` — orquesta inspección → extracción → contención, con **rollback** del destino ante cualquier fallo. `processElpxUpload` pasa a usarlo.

**B. Renderizado con origen opaco (no hay SCORM).**
* Servidor: se añade `sandbox allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox` (sin `allow-same-origin`) a la CSP de las respuestas HTML en `elpx-content.ts`. La directiva `sandbox` en la CSP fuerza origen opaco aunque el contenido se abra en una pestaña nueva.
* Cliente: se retira `allow-same-origin` de todos los iframes que muestran **contenido de autor** (preview en `ResourceCard`, `HomeDataIsland`, `CatalogIsland`, `PublicCollectionsIsland`, `catalog-controller`, `ResourceDetailIsland` y la previsualización de `EditarPage`). El iframe del **editor eXeLearning** (código first-party, con su puente `postMessage` de exportación) queda intacto de forma consciente.

## Consecuencias

### Positivas
* Zip slip, symlink y zip bomb quedan mitigados con validación previa + contención posterior y rollback.
* El JavaScript de autor sigue ejecutándose (la interactividad de los iDevices se preserva), pero con **origen opaco**: aunque el contenido ejecute scripts, no puede leer ni usar la sesión autenticada de la plataforma.
* La directiva `sandbox` en la CSP protege incluso si la vista del `.elpx` se abre directamente, no solo embebida.
* Inspección del ZIP sin dependencias nuevas; se reutiliza la lógica probada del plugin de Moodle.

### Negativas / Riesgos
* Pequeño coste de rendimiento por la inspección previa del directorio central y el barrido post-extracción.
* Los límites anti zip-bomb (`DEFAULT_ELPX_EXTRACT_LIMITS`) deben mantenerse y ajustarse si aparecen paquetes legítimos muy grandes.
* No se soportan archivos ZIP64 (fail-closed); eXeLearning no los genera, pero queda documentado como limitación.
* El iframe del editor first-party conserva `same-origin` por necesidad funcional; es una excepción consciente y acotada a código propio.

## Notas de Implementación

* Punto de extensión de extracción: `safeExtractElpx` en `apps/api/src/services/elpx-safe-extract.ts`; límites por defecto en `DEFAULT_ELPX_EXTRACT_LIMITS` (5 000 entradas, 500 MiB, ratio 500), configurables por parámetro.
* Punto de extensión de renderizado: la cabecera `Content-Security-Policy` en `apps/api/src/routes/elpx-content.ts`.
* Validación (regla 14): tests en `apps/api/src/services/elpx-safe-extract.unit.test.ts` (zip slip, symlink, zip bomb por número/tamaño/ratio, contención y rollback) y aserción de la directiva `sandbox` en `elpx-processor.unit.test.ts`. Verificar con `bun test`.
* Evolución futura: evaluar la Opción 3 (`fflate`) para eliminar el subproceso `unzip`.

## Adenda 2026-10-14 — sin `frame-ancestors` ni `X-Frame-Options` en el HTML del paquete (#379, #381, #391)

**Problema.** El HTML del `.elpx` se servía con `frame-ancestors 'self'`. Ese documento es origen opaco (sandbox sin `allow-same-origin`). Cuando el paquete anida otro HTML propio en un iframe (el reproductor `cargaSonidoHTML5.html` de eXeLearning en #379, la diapositiva de #391, el «cuadro gris» de #381), el ancestro del hijo es ese origen opaco. Chromium y WebKit no casan un ancestro opaco con ninguna fuente: bloquean el hijo con `'self'`, con el origen explícito y también con `*`. Solo Firefox acepta `*`. Lo mismo pasa con `X-Frame-Options: SAMEORIGIN`, que `nginx.conf` añadía a todo `/api/`. Comprobado en Chrome 155 con los paquetes reales de #379 y #391: el hijo solo carga si la respuesta no lleva `frame-ancestors` ni `X-Frame-Options`.

**Decisión.** Se quita `frame-ancestors` de `ELPX_HTML_CSP` (`apps/api/src/routes/elpx-content.ts`) y `/api/v1/elpx/` tiene su propio `location` en `nginx.conf`, sin `X-Frame-Options`. El resto de rutas conserva sus cabeceras. El `sandbox` no cambia: sigue sin `allow-same-origin`. La previsualización de versiones históricas (`admin/versions.ts`) usa la misma CSP; en `nginx.conf` sigue bajo `location /api/`, con `X-Frame-Options`, porque solo se libera `/api/v1/elpx/`. La imagen publicada (etapa `app`, Bun sin nginx) no añade `X-Frame-Options` en ninguna ruta.

**Por qué el riesgo es bajo.**
* El contenido es público: cualquiera puede verlo o descargarlo. Enmarcarlo fuera no expone nada nuevo.
* Se ejecuta en origen opaco, así que su JavaScript no lee la sesión ni el almacenamiento de Procomún, lo enmarque quien lo enmarque.
* La cookie de sesión es `SameSite=Lax` (`apps/api/src/auth/cookie-config.ts`): no viaja en un iframe de otro sitio, de modo que el clickjacking sobre una vista autenticada no tiene sesión que usar. La previsualización histórica de administración enmarcada desde fuera responde sin sesión.
* «Ponlo en tu web» necesita justo esto: con `'self'` el iframe en webs de terceros también quedaba bloqueado.

**Largo plazo.** La solución de fondo es la opción 3 de la [ADR-0027](0027-reproduccion-segura-embeds-elpx.md): servir los `.elpx` desde un origen separado sin cookies y quitar el sandbox.

**Validación.** `e2e/tests/public/elpx-nested-frame.e2e.ts` monta un paquete sintético con un HTML que anida otro en el visor de la ficha y comprueba que el hijo carga (falla con `'self'` y con `*`). `apps/api/src/routes/public-version-access.unit.test.ts` comprueba sobre la app completa que ni la ruta pública ni la previsualización histórica devuelven `frame-ancestors` ni `X-Frame-Options`.
