# Operación del preview HTTP del editor (sesiones en memoria)

Guía operativa del **preview HTTP del editor** (serving contract v2). Cubre qué
ocurre al desplegar/reiniciar, cómo se recupera el cliente, qué límites aplican y
cómo enrutar en un despliegue multi-réplica. La decisión de topología está en
[ADR-0030](../negocio/decisiones/0030-topologia-store-preview-http.md); el
contrato de servido, en [`docs/preview-serving-contract.md`](../preview-serving-contract.md).

> **No confundir** con el preview de contenido **publicado** `.elpx`
> (`/api/v1/elpx/:hash/*`, ADR-0026), que sí es persistente. Esta guía es solo
> del preview **del editor**, que es efímero.

## Modelo de almacenamiento

Cada sesión de preview vive en la **memoria del proceso `app`**
(`apps/api/src/services/preview-session-store.ts`). No se persiste en base de
datos ni en disco. Una sesión agrupa tres capas:

- **documentos generados** (HTML de páginas, CSS/JS generados), que cambian en
  cada edición mediante revisiones atómicas;
- **assets del proyecto** (imágenes/audio/vídeo/PDF del autor), inmutables por
  clave durante la vida de la sesión;
- **referencias a recursos fijos** de la instalación (librerías, runtimes de
  iDevices…), que no transfieren bytes.

La sesión es efímera: caduca por inactividad (TTL, 30 min por defecto) y la barre
un *sweeper*, o se borra explícitamente al cerrar el editor.

## Qué ocurre en un despliegue o reinicio

Al reiniciar el proceso `app` **todas las sesiones de preview desaparecen** (eran
solo memoria). Esto **no** provoca pérdida de datos del documento: la fuente de
verdad del proyecto es el `Y.Doc` del editor (y el guardado explícito/autosave),
no el preview.

El cliente se **recupera de forma transparente**: cualquier `404` de la API de
gestión (`/api/v1/preview-session/...`) o de la ruta de servido
(`/api/v1/preview/{previewId}/...`) le indica que la sesión ya no existe, y en el
siguiente refresco de preview la **vuelve a preparar** desde cero:

1. `POST /api/v1/preview-session` → nueva sesión (`201` con nuevo `previewId`).
2. `POST /api/v1/preview-session/{id}/assets` → resube los assets necesarios.
3. `POST /api/v1/preview-session/{id}/revisions` → publica la revisión actual.
4. El iframe recarga apuntando al nuevo `previewId`.

Para el usuario, el peor caso es un refresco de preview que se rehace solo. Aun
así, conviene **anunciar/drenar** los reinicios en horas de uso para no
interrumpir previews en vuelo.

## Límites: son POR PROCESO

Todas las cuotas del preview se cuentan **por réplica**, no de forma agregada en
el clúster. Con *N* réplicas, el consumo agregado de memoria puede acercarse a
*N* × tope. Dimensiona la RAM del contenedor en consecuencia. Valores por defecto
(todos sobreescribibles):

| Variable | Significado | Defecto |
|---|---|---|
| `PREVIEW_SESSION_TTL_MINUTES` | TTL de inactividad por sesión | `30` |
| `PREVIEW_MAX_SESSIONS_PER_USER` | Sesiones simultáneas por usuario | `4` |
| `PREVIEW_MAX_FILES_PER_SESSION` | Ficheros por sesión | `5000` |
| `PREVIEW_MAX_BYTES_PER_SESSION_MB` | Bytes por sesión | `200` |
| `PREVIEW_MAX_ASSET_BYTES_MB` | Bytes por asset | `128` |
| `PREVIEW_GLOBAL_MAX_BYTES_MB` | Tope global (con evicción LRU) | `2048` |

## Despliegue actual: réplica única

Producción es **una sola réplica** (`docker-compose.yml`: un servicio `app`;
`nginx.conf`: un único `proxy_pass http://api:3000` sin `upstream` ni afinidad).
En esta topología el *store* en memoria es correcto: toda petición de una sesión
cae por definición en el proceso que la posee. **No hay que configurar nada
adicional.**

## Escalado horizontal: enrutado *sticky* por `previewId`

Si se despliegan **varias réplicas**, el balanceador **debe** enrutar de forma
afín (*sticky*/*consistent-hash*) por el **segmento de ruta `previewId`** —un UUID
v4 estable durante toda la vida de la sesión— **tanto en gestión como en
servido**, para que todas las peticiones de una misma sesión lleguen a la réplica
propietaria. Si no, una sesión viva rebota entre réplicas y el cliente entra en un
bucle de recreación (404 → re-preparar → 404…).

### El caso del `CREATE`

`POST /api/v1/preview-session` **aún no tiene `previewId`** (lo acuña el servidor
en la respuesta `201`). Ese `POST` debe aterrizar en la réplica que **poseerá** la
sesión, y esa misma réplica debe recibir después las peticiones `:id`. Dos formas
de lograrlo:

- **Afinidad por cookie en el `CREATE`** (better-auth ya emite cookie
  mismo-origen): fija la réplica para el `POST` sin id y reutiliza esa afinidad
  para las peticiones `:id` del mismo cliente.
- **Create-then-pin**: la réplica que crea la sesión fija su `previewId` en el
  *hash ring* del balanceador.

### Ejemplo nginx (multi-réplica)

```nginx
# Varias instancias de la API. La afinidad se basa en el segmento previewId
# de la ruta, presente por igual en gestión y en servido.
upstream procomun_api {
    # Requiere el módulo ngx_http_upstream_hash: distribución consistente por
    # clave, con rebalanceo mínimo al añadir/quitar réplicas.
    hash $preview_affinity consistent;

    server api1:3000;
    server api2:3000;
    server api3:3000;
}

server {
    listen 80;

    # Captura el previewId de AMBAS familias de ruta:
    #   /api/v1/preview-session/{id}/...   (gestión)
    #   /api/v1/preview/{id}/...           (servido)
    # Para el POST de creación (sin id todavía) recae en la cookie de sesión,
    # de modo que el CREATE y sus peticiones :id caen en la misma réplica.
    set $preview_affinity $cookie_better_auth_session;
    location ~ ^/api/v1/preview-session/([0-9a-f-]{36})(/|$) {
        set $preview_affinity $1;
        proxy_pass http://procomun_api;
        proxy_set_header Host $host;
        client_max_body_size 10G;
        proxy_request_buffering off;
    }
    location ~ ^/api/v1/preview/([0-9a-f-]{36})(/|$) {
        set $preview_affinity $1;
        proxy_pass http://procomun_api;
        proxy_set_header Host $host;
    }

    # Resto de la API: sin afinidad especial.
    location /api/ {
        proxy_pass http://procomun_api;
        proxy_set_header Host $host;
        client_max_body_size 10G;
        proxy_request_buffering off;
    }
}
```

> Ajusta el nombre de la cookie (`$cookie_better_auth_session`) al que emita tu
> configuración de better-auth. El objetivo es que **el `CREATE` y las peticiones
> `:id` de un mismo cliente compartan réplica**.

## Salvaguarda de configuración

El servidor **no** detecta el clúster (no es fiable desde un proceso). En su
lugar hay un **acuse de recibo del operador**:

- Si declaras multi-réplica con `PREVIEW_MULTI_REPLICA=1` pero **no** confirmas el
  enrutado *sticky* con `PREVIEW_STICKY_ROUTING_CONFIRMED=1`, el servidor emite un
  `console.warn` prominente al arrancar (`apps/api/src/index.ts` →
  `evaluatePreviewReplicaConfig`).
- Tras configurar la afinidad como arriba, pon `PREVIEW_STICKY_ROUTING_CONFIRMED=1`
  para silenciar el aviso.
- En réplica única, deja ambas variables sin definir.

## Almacén compartido: descartado por ahora

Un *store* compartido/persistente (Redis/Postgres/S3) se descartó (ADR-0030): la
sesión mueve hasta 2 GiB de blobs y exige reproducir la garantía de **revisión
atómica** sobre el almacén externo. Se reevaluará junto al **origen separado sin
cookies** (ADR-0026/0027/0029), que es el horizonte de infraestructura donde esa
pregunta se reabre.
