# ADR-0048 Migración al bridge de medios externos compartido de eXeLearning

* Estado: Aceptado
* Fecha: 2026-06-29
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/frontend-ux-accesibilidad, @.agents/skills/interoperabilidad-educativa, @.agents/skills/qa-validacion]

## Contexto y Problema

ADR-0026 sirve el contenido `.elpx` con origen opaco y ADR-0027 resolvió la reproducción de vídeos y PDF mediante una implementación propia de Procomún. La familia eXeLearning dispone ahora de un bridge compartido más completo, con validación de mensajes, canonicalización de proveedores, overlay acotado y soporte para vídeo interactivo.

Mantener una variante local duplicaría lógica de seguridad y aumentaría el riesgo de divergencia.

## Fuente canónica

La fuente canónica del bridge, la política de medios y sus vectores de conformidad es **eXeLearning core**. Procomún mantiene copias vendorizadas verificables y no define una variante propia del protocolo. Las integraciones Moodle, WordPress y Omeka pueden consumir o espejar la misma fuente según su proceso de empaquetado.

El runtime hijo se incorpora a los paquetes exportados por el editor. Procomún mantiene el shim y el lado padre necesarios para servir paquetes existentes y promover medios permitidos.

## Decisión

Se sustituye el mecanismo propio de ADR-0027 por el bridge compartido de eXeLearning:

1. `apps/api/static/elpx/embed-shim.js` detecta embeds dentro del iframe opaco, conserva su geometría y comunica identificadores validados al padre.
2. `apps/frontend/public/elpx/exe_media_policy.js` concentra proveedores, identificadores, canonicalización y validaciones.
3. `apps/frontend/public/elpx/exe_embed_relay.js` valida `event.source`, reconstruye URLs desde plantillas fijas y crea un overlay limitado al área del contenido.
4. `apps/frontend/public/elpx/exe_media_host.js` soporta vídeo interactivo mediante `postMessage`, sin cargar SDK externos en la página padre.
5. El frontend carga estas piezas en orden y desmonta relay/host al destruir la vista.

ADR-0027 queda supersedida por ADR-0048.

## Invariantes de Seguridad

* El contenido de autor permanece en un iframe sin `allow-same-origin`.
* La confianza se basa en identidad de ventana y posesión del canal, no en un nonce visible para el iframe.
* Para YouTube y Vimeo cruza un identificador validado; el padre construye la URL canónica.
* No se acepta una URL arbitraria de autor para proveedores reconocidos.
* El overlay queda limitado geométricamente al contenido y no permite navegación superior.
* Los PDF conservan sandbox restrictivo y política de referrer adecuada.
* La política de cada iframe de vídeo usa `strict-origin-when-cross-origin`.

## Consecuencias

### Positivas

* Una única lógica de seguridad para las integraciones eXeLearning.
* Canonicalización de YouTube/Vimeo, validación estructural y soporte de vídeo interactivo.
* Menor coste de mantenimiento y menor riesgo de drift conceptual.

### Negativas / Riesgos

* Las copias vendorizadas deben actualizarse cuando cambie la fuente canónica.
* El contrato del runtime hijo y del host debe evolucionar de forma compatible.
* El modo abierto para embeds genéricos requiere conservar los guardrails del bridge y sus pruebas de conformidad.

## Validación y Operación

* Comparar las copias vendorizadas con la versión canónica mediante el comprobador mantenido por eXeLearning core.
* Ejecutar vectores de conformidad, tests de política y pruebas de navegador del overlay/host.
* Documentar en las cabeceras de los ficheros el origen y la versión sincronizada.
* Reevaluar el bridge si en el futuro el contenido se sirve desde un origen separado sin cookies, donde parte de esta promoción podría dejar de ser necesaria.

## Actualización 2026-10-26 — convivencia con una fachada genérica propia

El artefacto vendorizado solo reconoce YouTube, Vimeo, Dailymotion y la Mediateca de Madrid, y el relay añade los PDF. El resto de `<iframe>` https externos (Canva, Padlet, Genially, MuseScore…) se quedaba dentro del sandbox heredado y se veía en blanco o como un hueco negro. Con el shim de ADR-0027 se veían como un enlace «Ver contenido de…» (#427, #430, #450), así que sustituirlo sin más era una regresión.

Hasta que el artefacto incluya una fachada genérica (propuesta para eXeLearning) o el contenido se sirva desde un dominio propio (#429), conviven dos scripts en el HTML del `.elpx`:

1. **Artefacto de eXe** (`/api/v1/elpx/embed-shim.js`, bytes vendorizados sin cambios). Se inyecta primero.
2. **Fachada genérica** (`/api/v1/elpx/embed-facade.js`, `apps/api/static/elpx/embed-facade.js`). Se inyecta después, solo actúa en origen opaco y cambia por un enlace a una pestaña nueva los `<iframe>` https de otro host que no sean PDF ni de un proveedor del artefacto. Si el `<iframe>` va posicionado (código adaptable de Canva), el enlace ocupa el contenedor.

**Orden y reparto.**

* Los hosts excluidos (`ARTIFACT_HOSTS`) son exactamente los del registro del artefacto. Un test de `elpx-content` lo comprueba contra los bytes vendorizados, así que actualizar el artefacto con un proveedor nuevo obliga a actualizar la lista.
* La fachada corre al cargar el DOM. El artefacto solo cambia `<iframe>` tras el saludo con la ficha, así que normalmente la fachada llega antes.
* Si el artefacto se adelanta, deja un hueco negro (`[data-exe-embed-url]` sin proveedor) también para los hosts que no sabe reproducir. La fachada cambia igual esos huecos por el enlace.
* Fuera de la ficha («Ver online», «Ponlo en tu web») el artefacto no se activa y la fachada es la única que actúa.

**Pruebas.** `e2e/tests/public/elpx-embed-facade.e2e.ts`: el PDF y el YouTube los trata el artefacto y no la fachada; Padlet y Canva quedan como enlace en la ficha y en «Ver online»; la fachada de Canva ocupa su contenedor (#450).

Esta fachada desaparece cuando se cumpla cualquiera de las dos condiciones de arriba.

## Nota 2026-11-03 — renumeración

Hasta esta fecha, esta ADR se llamaba ADR-0033 en #293 y en #317. Pasa a ser ADR-0048 porque `main` ya tenía una ADR-0033 (capturas visuales de los PR con `workflow_run`). ADR-0046 es la de #481 y ADR-0047 la usó #484, ya cerrado. Cuando un comentario o una versión anterior de la descripción de #317 dice «ADR-0033», se refiere a esta decisión.
