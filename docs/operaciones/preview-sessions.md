# Operación del preview HTTP del editor

Guía operativa del Preview Serving Contract v2. La decisión de topología está en [ADR-0032](../negocio/decisiones/0032-topologia-store-preview-http.md) y el contrato técnico en [`preview-serving-contract.md`](../preview-serving-contract.md).

No debe confundirse con el contenido `.elpx` publicado en `/api/v1/elpx/:hash/*`: el preview del editor es efímero y vive en memoria.

## Modelo de almacenamiento

Cada sesión vive en la memoria de un proceso `app` y contiene:

- documentos generados, publicados mediante revisiones atómicas;
- assets del proyecto, inmutables por clave durante la sesión;
- referencias a recursos fijos de la instalación.

Caduca por inactividad o se elimina explícitamente. No se persiste en PostgreSQL ni en disco.

## Reinicios y recuperación

Al reiniciar el proceso se pierden las sesiones, no el documento editable. Ante un `404`, el cliente:

1. crea una sesión nueva;
2. vuelve a subir los assets necesarios;
3. publica la revisión actual;
4. recarga el iframe con el nuevo `previewId`.

Conviene drenar o anunciar reinicios en horas de uso para reducir resincronizaciones visibles.

## Límites por proceso

| Variable | Defecto | Significado |
|---|---:|---|
| `PREVIEW_SESSION_TTL_MINUTES` | `30` | TTL de inactividad |
| `PREVIEW_MAX_SESSIONS_PER_USER` | `4` | sesiones por usuario |
| `PREVIEW_MAX_FILES_PER_SESSION` | `5000` | rutas activas |
| `PREVIEW_MAX_BYTES_PER_SESSION_MB` | `200` | bytes totales por sesión |
| `PREVIEW_MAX_ASSET_BYTES_MB` | `128` | bytes por asset |
| `PREVIEW_GLOBAL_MAX_BYTES_MB` | `2048` | presupuesto global por proceso |
| `API_MAX_REQUEST_BODY_BYTES` | `268435456` | techo de cuerpo aplicado por Bun antes de Hono |

Las rutas multipart añaden una comprobación previa de `Content-Length`: máximo de sesión más un overhead acotado para metadatos y fronteras multipart. El techo de Bun protege peticiones sin longitud conocida y debe ser al menos igual al máximo funcional permitido.

No eleves estos valores sin medir RSS, memoria externa de `ArrayBuffer`, concurrencia y tiempo de recolección.

## Origen público del editor/API

Las mutaciones de preview deben proceder del origen que sirve el documento editor y la API de gestión:

- `PREVIEW_MANAGEMENT_ORIGIN`, cuando está definido;
- en caso contrario, el origen de `BETTER_AUTH_URL`;
- si tampoco existe, el fallback unificado de `FRONTEND_URL`.

En una topología separada, por ejemplo frontend en `app.example` y API/editor en `api.example`, el navegador envía `Origin: https://api.example`; ese es el origen que debe validarse. `FRONTEND_URL` sigue siendo el origen CORS del padre, pero no sustituye al origen del editor para CSRF.

## Despliegue de una réplica

Es la topología soportada por defecto. Todas las peticiones de una sesión llegan al mismo proceso y no requiere afinidad adicional.

## Escalado horizontal

Con varias réplicas, creación, gestión y servido deben mantener afinidad coherente:

- las rutas con `previewId` se distribuyen por hash consistente del id;
- `POST /api/v1/preview-session`, que todavía no tiene id, necesita afinidad de cookie o un mecanismo create-then-pin;
- la misma decisión debe cubrir `/preview-session/:id/*` y `/preview/:id/*`.

Ejemplo conceptual de nginx:

```nginx
upstream procomun_api {
    hash $preview_affinity consistent;
    server api1:3000;
    server api2:3000;
}

set $preview_affinity $cookie_better_auth_session;

location ~ ^/api/v1/preview-session/([0-9a-f-]{36})(/|$) {
    set $preview_affinity $1;
    proxy_pass http://procomun_api;
}

location ~ ^/api/v1/preview/([0-9a-f-]{36})(/|$) {
    set $preview_affinity $1;
    proxy_pass http://procomun_api;
}
```

Adapta el nombre de la cookie y el mecanismo del `CREATE` al balanceador real.

## Acuse de configuración

- `PREVIEW_MULTI_REPLICA=1` declara que hay varias réplicas.
- `PREVIEW_STICKY_ROUTING_CONFIRMED=1` confirma que creación, gestión y servido mantienen afinidad.
- Si la primera está activa y la segunda no, el servidor emite un aviso de arranque.

## Monitorización

Vigila:

- RSS y memoria externa por réplica;
- sesiones y bytes activos;
- respuestas `413` por límites de ruta o transporte;
- picos de `404` sin reinicio reciente, indicio de afinidad incorrecta;
- advertencias de configuración multi-réplica;
- tiempo de resincronización tras despliegue.

## Store compartido

Redis, PostgreSQL u object storage no se adoptan en esta fase: el estado es voluminoso, efímero y requiere swap atómico de revisión. Se reevaluará cuando la plataforma necesite escalado horizontal sin afinidad o un origen separado dedicado al contenido.
