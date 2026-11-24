# ADR-0044 Contador de visitas por recurso sin datos personales

* Estado: Propuesto
* Fecha: 2026-10-26
* Agentes Implicados: [@.agents/skills/analitica-y-observabilidad, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/backend-api-servicios, @.agents/skills/ingestas-y-migraciones]

## Contexto y Problema

En el Procomún antiguo cada recurso muestra un «Número de visitas» (issue #421). Producto acordó:

* Una visita por sesión, y solo cuando se abre la vista previa del recurso. Las recargas y volver a la ficha en la misma sesión no suman.
* El dato se muestra junto a la valoración, porque es un dato de uso.
* Solo cuenta y solo se muestra en recursos publicados (nota de #461).
* Las visitas históricas se migrarán cuando el exportador las incluya en el `.json`, como valor inicial del contador.

Hace falta identificar «la sesión» sin guardar datos personales: ni usuario, ni IP, ni huella del navegador.

## Opciones Consideradas

* **Hash de IP + user agent en el servidor.** No necesita nada en el navegador, pero es un dato personal (RGPD), agrupa a todo un centro educativo detrás de la misma IP y cambia en redes móviles.
* **Cookie propia de visitante.** Duradera: identifica a la misma persona entre visitas y exige aviso de cookies no técnicas.
* **UUID aleatorio por pestaña en `sessionStorage` y deduplicación en el servidor por recurso y sesión.** Desaparece al cerrar la pestaña, no se puede relacionar con nadie y no viaja en cada petición.
* **Contar en el navegador sin servidor.** No hay deduplicación fiable y cualquiera puede inflar el contador.

## Decisión

UUID aleatorio por pestaña en `sessionStorage` y deduplicación en el servidor.

* El navegador crea `crypto.randomUUID()` la primera vez y lo guarda en `sessionStorage` (`procomun:view-session`). Al cargar el `<iframe>` de la vista previa de la ficha (que es `loading="lazy"`, así que solo se carga si se llega a ver) o al pulsar «Ver online», llama una vez por recurso y sesión a `POST /api/v1/resources/:slug/view` con `{ sessionId }`. Marca el recurso en `sessionStorage` para no repetir la llamada al recargar.
* El servidor solo acepta un UUID y guarda su SHA-256 en `resource_view_sessions` (`resource_id`, `session_hash`, `created_at`, único por recurso y sesión). Si el par ya existe, no suma. No se guarda usuario ni IP.
* Las sesiones se purgan pasadas 24 h (`VIEW_SESSION_WINDOW_MS`) al registrar una visita nueva del mismo recurso. Una pestaña abierta más de un día vuelve a contar; se acepta.
* El total vive en `resource_view_counts` (`view_count` contado en la plataforma y `legacy_view_count` importado). Se muestra la suma.
* `resolveResourceBySlug` solo encuentra recursos publicados: un borrador, uno en revisión o uno archivado responde 404 y no cuenta. La ficha oculta el contador fuera de `published`, igual que la valoración.
* Migración `0013_resource_views`. Las `0011` y `0012` quedan para #397 y #457, que siguen abiertos.

## Consecuencias

### Positivas
* No hay datos personales: el identificador es aleatorio, vive solo en la pestaña y en el servidor solo queda su hash durante 24 h.
* Sin cookies nuevas, así que no cambia el aviso de cookies.
* El contador no se infla con recargas ni volviendo a la ficha.
* El valor histórico tiene su sitio desde ya y no se mezcla con lo contado en la plataforma.

### Negativas / Riesgos
* Cada pestaña nueva es una sesión nueva: abrir el mismo recurso en dos pestañas cuenta dos visitas.
* Un cliente que mande UUID distintos puede inflar el contador. Es el mismo nivel de confianza que el contador de descargas; si se abusa, habría que añadir límite por frecuencia en el proxy.
* Los recursos sin `.elpx` (solo ficheros) no tienen vista previa y, con la regla acordada, no suman visitas.

## Notas de Implementación

* Servicio: `apps/api/src/social/resource-views-service.ts`. Ruta: `POST /api/v1/resources/:slug/view`. `GET /api/v1/resources/:slug/stats` incluye `viewCount`.
* Frontend: `apps/frontend/src/lib/view-tracking.ts` y `ResourceDetailIsland.tsx`.
* **Importación pendiente:** `LegacyResourceInput.legacyViewCount` y el mismo campo opcional en el mapeo ya guardan el valor inicial en `resource_view_counts.legacy_view_count`. Falta leerlo del `.json` en `field-mapper.ts` cuando el exportador lo incluya: todavía no se conoce el nombre del campo. Los recursos ya importados se quedan a 0 hasta que se reimporten o se cargue el dato con una corrección.

## Visitas de colecciones públicas — 2026-11-20 (#608)

La ficha registra una visita al abrirse, con el mismo identificador aleatorio por pestaña y la misma deduplicación de 24 horas. Solo se registran visitas mientras la colección está publicada. El servidor guarda un hash separado del de los recursos y purga las sesiones caducadas al recibir otra visita de la misma colección.

`GET /api/v1/collections/:slug` devuelve `viewCount` y `POST /api/v1/collections/:slug/view` actualiza el contador. El total parte de cero para las colecciones existentes e importadas. El histórico de itinerarios se tratará en #574.
