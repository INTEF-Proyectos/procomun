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
