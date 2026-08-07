# ADR-0035 Previsualización opaca por snapshot completo en lugar del protocolo v2

* Estado: Aceptado
* Fecha: 2026-07-25
* Agentes Implicados: [@.agents/skills/interoperabilidad-educativa, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/backend-api-servicios, @.agents/skills/qa-validacion]

## Contexto y Problema

El preview HTTP v2 (ADR-0037) definía una API de gestión de cuatro operaciones —crear sesión, subir assets inmutables por clave, publicar revisiones incrementales del documento y borrar— más una capa de recursos fijos resuelta contra el manifiesto del editor instalado. Toda esa maquinaria existía por una única razón: no reenviar bytes que no habían cambiado entre refrescos.

El editor de eXeLearning dejó de hablar ese protocolo. La comprobación es directa y reproducible: un bundle construido desde la rama actual del editor **no contiene ninguna referencia** a `previewHttp` ni a `protocolVersion`, y sí lee `previewSnapshot` con `managementUrl`, `servingBaseUrl` y `deleteUrlTemplate`. El editor publica ahora el proyecto **completo como un ZIP** en cada refresco opaco.

La consecuencia era silenciosa y por eso grave: la plataforma inyectaba un contrato que nadie leía y omitía el único que el editor sí lee, de modo que la previsualización opaca nunca llegaba a activarse. Al fallar en cerrado, no había error visible; simplemente se quedaba la vista filtrada.

Es el mismo desajuste detectado y corregido en los adaptadores de WordPress, Moodle, Omeka S y Nextcloud: el editor cambió el contrato y los anfitriones no se enteraron.

## Opciones Consideradas

* **Mantener v2 y esperar** a que el editor lo reimplemente. Descartada: el editor ya eligió el contrato de snapshot; mantener código muerto que además da falsa sensación de cobertura es deuda pura.
* **Soportar ambos protocolos** durante una transición. Descartada: nadie emite v2 ya, así que la rama v2 no tendría ningún cliente ni forma de validarse; duplicaría la superficie de seguridad (dos rutas de escritura de bytes no confiables) a cambio de nada.
* **Sustituir v2 por el contrato de snapshot.** Elegida.

## Decisión

1. **Un archivo por refresco.** El editor envía el proyecto entero como ZIP a `POST /api/v1/preview-session` (multipart `snapshot`, con `previewId` opcional) y recibe la capability. El id ausente acuña una capability nueva; presente, la reemplaza en su sitio.
2. **La API de gestión queda en dos operaciones**: publicar y `DELETE /api/v1/preview-session/:previewId`. Desaparecen las subidas de assets, las revisiones incrementales y la capa de recursos fijos.
3. **Un snapshot es `ruta → bytes`.** Las tres capas colapsan en un mapa, y la resolución de servido pasa a ser una búsqueda exacta.
4. **La verificación del archivo es la frontera de confianza.** Se comprueban todas las entradas antes de descomprimir nada (rutas seguras, método de compresión soportado, número de ficheros, `index.html` presente) y el tope de bytes se aplica sobre los **bytes realmente inflados**, no sobre los tamaños declarados en el directorio central, que los elige quien construye el ZIP.
5. **Publicación no destructiva.** El mapa nuevo solo sustituye al anterior cuando el archivo ha pasado toda la verificación, de modo que una subida rechazada deja intacta la previsualización que ya funcionaba.
6. **El ETag incorpora una secuencia de publicación.** Al reemplazar se conserva el id de capability, así que un ETag derivado solo del id devolvería un 304 con bytes viejos tras cada refresco.
7. **Se mantiene la topología de ADR-0037**: store en memoria por proceso, recuperación por recreación ante un 404, una réplica por defecto, afinidad coherente en multi-réplica con acuse operativo, y cuotas locales al proceso (TTL de 30 min, 4 snapshots por usuario, presupuesto global con desalojo LRU).

## Consecuencias

### Positivas

* La previsualización opaca pasa a ser alcanzable: se emite el contrato que el editor lee.
* Se retiran ~2.900 líneas entre store por capas, recursos fijos, rutas de gestión y sus pruebas y vectores.
* Menos superficie de ataque: una sola ruta por la que entran bytes no confiables, con verificación previa a cualquier escritura.
* El desajuste queda cubierto por pruebas de regresión: el HTML de bootstrap se comprueba explícitamente para que no reaparezcan `previewHttp` ni `protocolVersion`.

### Negativas / Riesgos

* **Se reenvía el proyecto entero en cada refresco.** Es el coste que la maquinaria v2 evitaba. Lo acota el tope por snapshot (200 MiB por defecto) y lo compensa que el editor comprime el ZIP.
* **La activación real depende del editor.** `make download-exelearning-editor` descarga la *release* publicada; mientras esa release no incluya la frontera de confianza, la previsualización seguirá filtrada. Es el comportamiento correcto (falla en cerrado), pero significa que esta ADR no se activa sola al mergear.
* El stub que neutraliza el Service Worker heredado sigue siendo necesario hasta que llegue ese editor.

## Notas de Implementación

* Nuevo: `apps/api/src/services/preview-snapshot-store.ts`, `preview-snapshot-archive.ts` y `preview-snapshot-test-zip.ts` (constructor de ZIP para fixtures, incluidos archivos que mienten sobre su tamaño).
* Retirado: `preview-session-store.ts`, `preview-fixed-resources.ts`, `preview-contract.unit.test.ts` y `apps/api/test/preview-contract/`.
* `apps/api/src/routes/preview.ts` conserva íntegra la política de servido —cabeceras de endurecimiento, CSP sandbox byte a byte idéntica al core, ETag/304, rangos 206/416 y la redirección relativa de la URL desnuda—; solo pierde la capa fija.
* Enmienda ADR-0037 en sus puntos 1 y 10; el resto de su topología sigue vigente.
* Contrato actualizado en `docs/preview-serving-contract.md`.
