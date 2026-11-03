# Requirements — Miniaturas generadas en el servidor

* Issue: #470 (sale de #409)
* ADR: ADR-0046 (Propuesto)
* Fecha: 2026-10-27

## Problema público

Las tarjetas de los recursos que no traen imagen cargan un iframe vivo del paquete: pesa, ejecuta el contenido del autor en cada tarjeta y, si el paquete falla, enseña su error. Quitar el iframe sin otra imagen deja esos recursos con un icono genérico (#426) y empeora el descubrimiento.

## Usuario principal

Docente que explora el catálogo (Explorar, portada, colecciones, recomendados) y decide por la tarjeta si abre un recurso.

## Alcance

### In scope

1. Generar una miniatura de la portada (`index.html`) de cada paquete `.elpx` que no trae `screenshot.png`.
2. Hacerlo en segundo plano tras la subida, el editor, la administración y la importación legacy.
3. Comando de relleno para los paquetes ya subidos.
4. Usar la miniatura en las tarjetas y quitar el iframe de los listados.

### Out of scope

* Cambiar la ficha del recurso, que sigue con su visor.
* Miniaturas de ficheros que no son `.elpx` (PDF, vídeo…).
* Origen separado para los `.elpx` (ADR-0027, opción 3; #429).

## Requisitos funcionales

* **RF-1.** Un paquete con `index.html` y sin `screenshot.png` queda con estado `pending` al procesarse.
* **RF-2.** Un trabajo en segundo plano genera la miniatura y la guarda en `storageDir/thumbnails/` con nombre `<sha256>.<ext>`.
* **RF-3.** Si la portada está vacía o la captura falla tras los reintentos, el estado lo dice (`empty` o `failed`) y la tarjeta muestra el marcador por tipo.
* **RF-4.** Orden de la tarjeta: `screenshot.png` > `preview` legacy > miniatura generada > marcador por tipo. Ningún listado carga iframes.
* **RF-5.** `elpx:thumbnails [--dry-run] [--limit N] [--force]` marca los pendientes del fondo e informa de los totales por estado.
* **RF-6.** Restaurar una versión conserva la miniatura del proyecto `.elpx` al que apunta.

## Requisitos no funcionales

* **RNF-1 (seguridad).** El contenido del autor nunca se ejecuta con el origen de la plataforma, ni con acceso a red, sesión, secretos o base de datos.
* **RNF-2 (robustez).** Un paquete no puede bloquear el servicio: tiempo máximo por paquete y límites de memoria y procesos.
* **RNF-3 (disponibilidad).** Si el servicio de captura no está, las subidas siguen funcionando y los trabajos esperan.
* **RNF-4 (accesibilidad).** La miniatura es decorativa en la tarjeta (`alt=""`), porque el título ya da el nombre; el marcador lleva `aria-hidden`.
* **RNF-5 (rendimiento).** Miniatura de 640×400 y como mucho 100 KB; la ruta de miniaturas responde con caché inmutable.

## Criterios de aceptación (de la issue)

* Un paquete sin `screenshot.png` tiene una miniatura generada después de subirlo o del relleno.
* Los listados no cargan iframes.
* La generación no ejecuta el contenido del autor con el origen de la plataforma.
* ADR con la decisión de infraestructura.

## Actualización 2026-11-03 — ADR aceptada y revisión de #481

### Estado

ADR-0046 está **Aceptada** desde el 2026-11-03. Las preguntas abiertas de #470 las cerró @juanda: ver [«Decisiones del 2026-11-03» en ADR-0046](../../../../negocio/decisiones/0046-miniaturas-generadas-en-servidor.md#decisiones-del-2026-11-03). El «(Propuesto)» de la cabecera queda como historia.

Lo que cambia respecto a lo de arriba:

* **RF-4.** El iframe sale de los listados en cuanto se despliega, sin esperar al relleno. Mientras un recurso no tiene miniatura, se ve el marcador de su tipo.
* **RF-5.** `elpx:thumbnails` marca solo los proyectos sin imagen propia: ni `screenshot.png` ni `preview` legacy.
* **RF-2.** La captura es un JPEG de 640×400 solo del contenido, sin la navegación de eXe.
* **RNF-5.** La ruta de miniaturas deja de responder con caché inmutable: ver RNF-6.

### Acceso según el estado editorial (revisión de @jacoboAlcantara en #481)

Decisión en la [«Adenda 2026-11-03 — acceso a las miniaturas según el estado editorial»](../../../../negocio/decisiones/0046-miniaturas-generadas-en-servidor.md) de ADR-0046.

* **RF-7.** La miniatura de un recurso publicado se sirve por la URL estable `/api/v1/thumbnails/<fichero>` solo si el fichero pertenece al menos a un recurso publicado y no borrado (por `resources.thumbnail_url` o por el proyecto `.elpx` vigente).
* **RF-8.** La miniatura de un recurso en borrador, revisión o archivado solo se entrega con un enlace firmado (`/api/v1/thumbnails/signed/<caducidad>.<firma>/<fichero>`, 2 horas), y solo a quien puede ver el recurso (`canViewResource`). `screenshot.png` usa el enlace firmado del paquete de #466.
* **RF-9.** Al despublicar, la URL estable responde 404 desde la petición siguiente. Al volver a publicar, vuelve a servirse.
* **RF-10.** Ningún listado ni página entrega la URL estable de la miniatura de un recurso no publicado: ficha, panel, favoritos, valoraciones, administración y colecciones de administración. Si quien pide no puede ver el recurso, no se entrega ninguna.
* **RF-11.** Las imágenes `preview` legacy siguen las mismas reglas que la miniatura generada.
* **RNF-6 (caché).** URL estable: `public, max-age=3600`, sin `immutable`. Enlace firmado, también el `screenshot.png` del enlace firmado del paquete: `private, no-store`. Tras despublicar, una copia en un navegador o un proxy puede durar como mucho 1 hora.
* **RNF-7 (privacidad).** Un 404 de la URL estable no distingue entre «no existe» y «no está publicado».

### Criterios de aceptación del acceso

* **CA-1 (borrador).** La URL estable de su miniatura da 404, con sesión o sin ella. La autora recibe en la ficha y en su panel un enlace firmado que da 200 con `private, no-store`. Otra autora no recibe ninguna URL.
* **CA-2 (revisión).** La URL estable da 404. La autora, el curator y el admin reciben el enlace firmado.
* **CA-3 (publicado).** La URL estable da 200 con `public, max-age=3600` y sin `immutable`. Los listados públicos la entregan sin token.
* **CA-4 (archivado).** La URL estable da 404. El curator y el admin reciben el enlace firmado.
* **CA-5 (cambios de estado).** Publicado → archivado: la URL estable da 404 en la petición siguiente. Archivado → borrador → publicado: vuelve a dar 200. Un enlace firmado caduca a las 2 horas.
* **CA-6 (firma).** Un token alterado, caducado, emitido para otro fichero o de la vista previa del paquete da 404.
* **CA-7 (imagen compartida).** Un fichero que comparten un recurso publicado y un borrador se sirve por la URL estable: es la misma imagen pública.
* **CA-8 (copia de trabajo).** La miniatura de un proyecto que no es el vigente de un recurso publicado no sale por la URL estable.
* **CA-9 (borrado).** La miniatura de un recurso borrado no se sirve por ninguna de las dos rutas.
* **CA-10 (#471).** `elpxPreview` sigue existiendo si hay visor o miniatura, y la miniatura no depende del visor.
