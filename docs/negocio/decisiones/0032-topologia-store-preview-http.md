# ADR-0032 Topología del preview HTTP y cableado del editor embebido

* Estado: Aceptado
* Fecha: 2026-07-11
* Agentes Implicados: [@.agents/skills/seguridad-privacidad-legal, @.agents/skills/interoperabilidad-educativa, @.agents/skills/qa-validacion]

## Contexto y Problema

El preview HTTP v2 separa una API de gestión autenticada (`/api/v1/preview-session`) de una capability URL sin cookies (`/api/v1/preview/:previewId/*`). Cada sesión contiene documentos generados, assets del proyecto y referencias a recursos fijos. Las revisiones se publican de forma atómica.

El store actual es un `Map` en memoria del proceso. Esto es adecuado para el despliegue actual de una réplica, pero obliga a definir reinicios, límites de memoria y escalado horizontal.

El editor se sirve desde la API y puede estar embebido por un frontend en otro origen. Las operaciones de gestión nacen en el origen del documento editor/API, no necesariamente en `FRONTEND_URL`.

## Decisión

1. **Store en memoria por proceso.** Las sesiones son efímeras, no se persisten y se eliminan por TTL o presión de límites.
2. **Recuperación por recreación.** Un reinicio invalida las sesiones; el cliente recrea sesión, assets y revisión al recibir un 404. El documento editable sigue viviendo en el editor, no en el preview.
3. **Una réplica por defecto.** Es la topología soportada sin configuración adicional.
4. **Multi-réplica con afinidad coherente.** Gestión y servido de un `previewId` deben llegar a la misma réplica. La creación, que todavía no tiene id, requiere afinidad de sesión o un mecanismo create-then-pin compatible con el balanceador.
5. **Acuse operativo.** Si el operador declara multi-réplica sin confirmar sticky routing, el servidor emite una advertencia de arranque.
6. **Límites por proceso.** Cuotas de sesiones y bytes son locales a cada réplica; el dimensionamiento agregado debe multiplicarlas por el número de procesos.
7. **Origen CSRF.** Las mutaciones de gestión exigen `Origin` igual al origen público que sirve el editor y la API (`PREVIEW_MANAGEMENT_ORIGIN`, o `BETTER_AUTH_URL` como valor por defecto), además de `Sec-Fetch-Site: same-origin` cuando el navegador lo envía. `FRONTEND_URL` sigue gobernando el CORS credencializado del frontend, pero no se usa como sustituto del origen real del editor.
8. **Capability de servido.** La ruta de servido no acepta credenciales, responde con `Access-Control-Allow-Origin: *` y conserva el sandbox/CSP para documentos scriptables.
9. **Límite antes del parseo multipart.** Las rutas de assets y revisiones comprueban `Content-Length` antes de llamar a `formData()`. Bun aplica además `API_MAX_REQUEST_BODY_BYTES` como techo de transporte para peticiones sin longitud conocida o clientes no conformes.
10. **Activación del editor.** El bootstrap inyecta `previewHttp` v2 y neutraliza el Service Worker heredado. La activación real depende de un artefacto de eXeLearning core con `HttpPreviewProvider` y el manifiesto de recursos fijos.

## Seguridad

* Las operaciones de gestión requieren sesión y propiedad de la sesión de preview.
* La validación de origen usa el origen del editor/API, lo que evita tanto CSRF desde subdominios hermanos como el bloqueo incorrecto de despliegues frontend/API separados.
* Los valores de query inyectados en el bootstrap se serializan con JSON seguro para scripts; se escapan `<`, `>`, `&`, U+2028 y U+2029 para impedir `</script>` breakout.
* El iframe de preview no recibe `allow-same-origin`; HTML, SVG, XML y XHTML reciben la CSP sandbox-first incluso cuando la capability URL se abre directamente.
* Los cuerpos multipart se rechazan antes de su materialización cuando superan el presupuesto anunciado.

## Consecuencias

### Positivas

* No se introduce infraestructura distribuida para un estado temporal.
* Las revisiones conservan publicación atómica y baja latencia.
* Los reinicios son recuperables sin persistir contenido de preview.
* El contrato funciona en topología unificada y en despliegues con frontend y API en orígenes distintos.
* El pico de memoria de una petición queda acotado por el límite de ruta y el techo de transporte.

### Negativas / Riesgos

* Una mala afinidad en multi-réplica produce 404 y recreaciones repetidas.
* Los límites globales son por proceso y el consumo agregado aumenta con cada réplica.
* Un reinicio obliga a resincronizar assets y revisión.
* El techo de transporte debe ser igual o superior al máximo funcional de preview más el overhead multipart.

## Configuración

* `PREVIEW_MULTI_REPLICA=1`: declara despliegue con varias réplicas.
* `PREVIEW_STICKY_ROUTING_CONFIRMED=1`: confirma afinidad coherente para creación, gestión y servido.
* `PREVIEW_MANAGEMENT_ORIGIN`: origen público opcional del editor/API; por defecto se deriva de `BETTER_AUTH_URL`.
* `API_MAX_REQUEST_BODY_BYTES`: techo de cuerpo aplicado por Bun antes de Hono; defecto 256 MiB.
* `PREVIEW_MAX_BYTES_PER_SESSION_MB`, `PREVIEW_MAX_ASSET_BYTES_MB`, `PREVIEW_GLOBAL_MAX_BYTES_MB`: límites del store.

## Validación

* Tests del store, publicación atómica, ownership, TTL y presupuestos.
* Tests de Range, ETag, CSP y CORS de la capability URL.
* Regresión con frontend y API en orígenes distintos: se acepta el origen API/editor y se rechaza el del padre.
* Regresión XSS con `elpxUrl`/`resourceId` que contienen `</script>`.
* Regresión de `Content-Length`: límite exacto aceptado y un byte adicional rechazado antes de parsear multipart.
* E2E con un artefacto de editor compatible antes de activar el transporte en producción.

ADR-0032 complementa ADR-0031: el bridge compartido resuelve medios externos del contenido publicado y esta ADR resuelve el preview efímero del editor.
