# ADR-0030 Topología de almacenamiento del preview HTTP (store en memoria por proceso + enrutado *sticky* por `previewId`) y cableado del editor embebido

* Estado: Aceptado
* Fecha: 2026-07-11
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/interoperabilidad-educativa, @.agents/skills/qa-validacion]

## Contexto y Problema

La rama `feat/align-embed-bridge-with-mod` incorpora, además de la migración del
bridge de medios ([ADR-0029](0029-migracion-bridge-medios-compartido-exelearning.md)),
el **servidor completo del preview HTTP del editor (serving contract v2)**:

* API de gestión, autenticada y *owner-gated* (`/api/v1/preview-session`): crear
  sesión, subir *assets*, publicar revisiones atómicas, borrar
  ([`apps/api/src/routes/preview.ts`](../../../apps/api/src/routes/preview.ts)).
* Ruta de servido, sin cookies, tipo *capability URL*
  (`/api/v1/preview/:previewId/*`), que sirve las tres capas al iframe de origen
  opaco.
* *Store* de las sesiones
  ([`apps/api/src/services/preview-session-store.ts`](../../../apps/api/src/services/preview-session-store.ts)):
  un `Map` **en la memoria del proceso** (`sessions` en `preview-session-store.ts`),
  portado del core de eXeLearning. La cabecera del módulo ya advierte
  literalmente que *«los despliegues con varias instancias tras un balanceador
  necesitan sesiones sticky»* — pero hasta ahora era **solo un comentario**, sin
  decisión registrada ni salvaguarda operativa.

El problema a decidir es **qué topología de almacenamiento soporta este preview**
y **cómo se comporta el sistema al escalar horizontalmente o al reiniciar**, dado
que la sesión es un estado voluminoso (hasta 2 GiB de blobs de media por el tope
global) con garantías de **revisión atómica** (un `GET` concurrente observa la
revisión *N* o *N+1*, nunca una mezcla).

### Estado actual de producción (por qué el *store* en memoria es correcto hoy)

Producción es **una sola réplica**. No hay `upstream` con varias instancias ni
afinidad configurada:

* [`docker-compose.yml`](../../../docker-compose.yml) define un único servicio
  `app` (todo-en-uno: API + frontend) y un `db` Postgres. No hay `deploy.replicas`
  ni escalado del contenedor `app`.
* [`nginx.conf`](../../../nginx.conf) hace un único `proxy_pass http://api:3000`
  para `location /api/`, **sin** bloque `upstream`, `ip_hash`, `hash` ni ninguna
  directiva de *stickiness*. No hay Kubernetes ni orquestador con réplicas.

Con una sola réplica, todas las peticiones de gestión y de servido de una sesión
caen por definición en el proceso que la posee: el `Map` en memoria es la
elección correcta y más simple, sin coste de infraestructura añadido.

### Dependencia de activación (el editor embebido todavía no lo consume)

El *bootstrap* del editor embebido
([`apps/api/src/routes/exelearning-editor.ts`](../../../apps/api/src/routes/exelearning-editor.ts))
ahora **inyecta la configuración `previewHttp`** (`protocolVersion: 2`,
`managementBaseUrl: /api/v1/preview-session`, `servingBaseUrl: /api/v1/preview`)
en `window.__EXE_EMBEDDING_CONFIG__`. Sin embargo, el editor estático empaquetado
(v4.0.1) **es anterior** al `HttpPreviewProvider` del core y todavía usa el
transporte heredado de Service Worker mismo-origen (`srcdoc` ya no existe como
transporte de contenido en el core). Por tanto, **las rutas HTTP v2 quedan
servidas y probadas, pero aún no las conduce
ningún editor**: la activación real depende de una **release del core** con
`HttpPreviewProvider` y con el manifiesto `bundles/preview-fixed-resources.json`
(que el `Dockerfile` descarga desde la última release de `exelearning/exelearning`).
El cableado se deja hecho ahora para que la activación sea solo actualizar esa
release, sin tocar Procomún.

## Opciones Consideradas

* **Opción A — *Store* en memoria + enrutado *sticky* por `previewId` (elegida).**
  Mantener el `Map` por proceso. Hoy funciona tal cual (réplica única). Como
  *senda de escalado*, enrutar de forma *sticky*/*consistent-hash* por el
  **segmento de ruta `previewId`**, tanto en gestión
  (`/api/v1/preview-session/:id/...`) como en servido (`/api/v1/preview/:id/...`),
  para que toda petición de una sesión caiga siempre en la réplica propietaria.
* **Opción B — *Store* compartido/persistente** (Redis/Postgres/S3): cualquier
  réplica sirve cualquier sesión. Descartada por ahora: mueve hasta 2 GiB de
  blobs por sesión a un almacén externo y hay que **reproducir la garantía de
  revisión atómica** (el *swap* síncrono de documentos + mapas de refs + número
  de revisión) sobre ese almacén, con su latencia y su coste. Sobredimensionado
  para un preview efímero de vida corta.
* **Opción C — Re-sincronización transparente sin afinidad.** Confiar en que el
  cliente recree la sesión ante cualquier 404. Descartada como *solución de
  enrutado*: la recuperación por 404 es real y deseable (ver Consecuencias), pero
  **sin** afinidad una sesión viva rebota entre réplicas y el cliente entraría en
  un bucle de recreación en cada refresco. La re-sincronización solo es una red
  de seguridad **junto con** la Opción A, no un sustituto del enrutado.

## Decisión

Se adopta la **Opción A**.

1. **Hoy: réplica única, *store* en memoria.** Es la topología correcta para el
   despliegue actual (un `app`, un `proxy_pass`). No se añade infraestructura.
2. **Senda de escalado: enrutado *sticky* por `previewId`.** Para multi-réplica,
   la afinidad se basa en el **segmento de ruta `previewId`** (un UUID v4 estable
   durante toda la vida de la sesión), aplicada por igual a **gestión y servido**.
   Un `hash $uri consistent` (o `hash` sobre una captura del segmento de id) en
   nginx basta; no requiere cookies para el servido (que es *cookieless* a
   propósito).
   * **Caveat del `CREATE`.** `POST /api/v1/preview-session` **todavía no tiene
     id** (el servidor lo acuña en la respuesta 201). Ese `POST` debe aterrizar
     en la réplica que va a **poseer** la sesión y coincidir con la que luego
     recibirá las peticiones `:id`. Se resuelve con **afinidad por cookie** en el
     `POST` de creación (better-auth ya emite cookie mismo-origen) o con un
     patrón *create-then-pin* (la réplica que crea fija el id en su *hash ring*).
     Sin este cuidado, la sesión se crea en una réplica y sus `:id` van a otra.
3. ***Store* compartido rechazado por ahora**, y **diferido al mismo horizonte**
   que la *Opción 3* de la [ADR-0029](0029-migracion-bridge-medios-compartido-exelearning.md)
   y las [ADR-0026](0026-apertura-segura-elpx.md)/[ADR-0027](0027-reproduccion-segura-embeds-elpx.md):
   el **origen separado sin cookies**. Si se acomete ese cambio de
   infraestructura (DNS/TLS/CORS), es el momento natural de reevaluar un almacén
   compartido para el preview.

## Consecuencias

### Positivas

* **Cero infraestructura nueva hoy.** El preview v2 funciona sobre el despliegue
  actual sin balanceador ni almacén externo.
* **Recuperación transparente ante despliegue/reinicio.** Las sesiones son
  efímeras y **no se persisten**: mueren al reiniciar el proceso. El cliente las
  **recrea de forma transparente** en el siguiente refresco — cualquier 404 de la
  API de gestión o de la ruta de servido dispara una re-preparación (crear sesión
  → subir assets → publicar revisión). No hay estado que migrar ni que respaldar.
* **Salvaguarda de configuración honesta.** El servidor no finge detectar un
  clúster; avisa si el operador declara multi-réplica sin confirmar el enrutado
  *sticky* (ver Notas de Implementación).

### Negativas / Riesgos

* **Los límites globales son por proceso.** El tope global (2 GiB por defecto,
  `PREVIEW_GLOBAL_MAX_BYTES_MB`) y el resto de cuotas se cuentan **por réplica**,
  no de forma agregada en el clúster. Con *N* réplicas el consumo agregado de
  memoria puede llegar a *N* × tope. Debe dimensionarse en consecuencia.
* **Un reinicio interrumpe los previews en vuelo.** El usuario ve como mucho un
  refresco de preview que se rehace solo; no hay pérdida de datos del documento
  (la fuente de verdad es el Y.Doc del editor, no el preview), pero conviene
  drenar/anunciar reinicios en horas de uso.
* **La afinidad hay que operarla bien.** Un enrutado *sticky* mal configurado
  (p. ej. *hash* solo en servido pero no en gestión, o sin resolver el `CREATE`)
  reintroduce los 404 esporádicos. De ahí la salvaguarda y la documentación.

## Notas de Implementación

* **Salvaguarda de configuración (la más barata y honesta).** No hay detección de
  clúster fiable desde un proceso, así que se implementa un **acuse de recibo del
  operador**: `evaluatePreviewReplicaConfig(env)` en
  [`preview-session-store.ts`](../../../apps/api/src/services/preview-session-store.ts)
  devuelve un aviso si `PREVIEW_MULTI_REPLICA` está activo pero
  `PREVIEW_STICKY_ROUTING_CONFIRMED` no lo está; el *entrypoint*
  ([`apps/api/src/index.ts`](../../../apps/api/src/index.ts)) lo registra con
  `console.warn` al arrancar. Es una función pura, cubierta por tests unitarios.
* **Documentación de despliegue:**
  [`docs/operaciones/preview-sessions.md`](../../operaciones/preview-sessions.md) —
  qué ocurre en despliegue/reinicio, cómo funciona la recuperación por 404, que
  los límites son por proceso, y un ejemplo de *snippet* nginx con
  `hash`/*consistent hash* por `previewId` para multi-réplica (incluido el
  tratamiento del `CREATE`).
* **Dependencia de activación (bloqueante para el uso real).** Hasta que exista
  una release del core de eXeLearning con `HttpPreviewProvider` y el manifiesto
  `bundles/preview-fixed-resources.json`, el editor empaquetado seguirá usando el
  transporte heredado y las rutas HTTP v2 no se ejercitarán *end-to-end* con un
  editor real. El cableado (`previewHttp`) ya está listo para esa release.
* **Evolución futura preferente:** el **origen separado sin cookies**
  (ADR-0026/0027/0029, *Opción 3*) es el horizonte en el que se reabrirá la
  pregunta del *store* compartido.
