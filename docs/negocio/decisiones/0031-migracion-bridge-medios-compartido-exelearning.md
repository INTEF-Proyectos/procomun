# ADR-0031 Migración al bridge de medios externos compartido de eXeLearning

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

ADR-0027 queda supersedida por ADR-0031.

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
