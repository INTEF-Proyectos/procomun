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

## Addendum 2026-10-14 — iframes a otro HTML del mismo paquete

Una presentación exportada por eXeLearning (p. ej. el ODE `1535372179937`) mete cada diapositiva en un `<iframe>` cuyo `src` es otro HTML del propio paquete, no un host externo. El documento padre ya es origen opaco (`sandbox` sin `allow-same-origin`). Con `frame-ancestors 'self'` el ancestro `null` no coincide y Chrome descarta al hijo mostrando «localhost rechazó la conexión» (`ERR_BLOCKED_BY_RESPONSE`).

Se mantiene el origen opaco. La CSP del HTML pasa a `frame-ancestors *` para poder anidar ese HTML. No se añaden `allow-same-origin` ni `allow-top-navigation`. Las URLs que el editor deja como `http://localhost`, `http://127.0.0.1` o `{{context_path}}` y cuya ruta no sale del paquete se reescriben a `/api/v1/elpx/{hash}/…`; si la ruta no es segura, el iframe se elimina.
