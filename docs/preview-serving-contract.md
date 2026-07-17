# HTTP editor preview — Procomún adapter

Procomún implements eXeLearning **Preview Serving Contract v2** for the embedded editor. eXeLearning core is canonical for the protocol, CSP, scriptable MIME set, bridge files, and conformance vectors. This document records the adapter mapping and constraints defined by ADR-0034.

The authored preview runs in an iframe without `allow-same-origin`. Scriptable responses receive the sandbox-first CSP, so opening a capability URL directly does not restore a trusted origin.

## Transport configuration

The editor bootstrap injects:

```jsonc
{
  "previewHttp": {
    "protocolVersion": 2,
    "managementBaseUrl": "/api/v1/preview-session",
    "servingBaseUrl": "/api/v1/preview"
  }
}
```

Management uses `credentials: "same-origin"`; serving uses `credentials: "omit"`. The legacy same-origin preview Service Worker is neutralized until a compatible editor artifact is installed.

All query-controlled values injected into the bootstrap are encoded with script-safe JSON. Literal `<`, `>`, `&`, U+2028, and U+2029 are escaped to prevent `</script>` breakout.

## Endpoint mapping

| Operation | Route | Trust model |
|---|---|---|
| Create session | `POST /api/v1/preview-session` | authenticated, origin-validated |
| Upload assets | `POST /api/v1/preview-session/{previewId}/assets` | authenticated, owner-scoped |
| Publish revision | `POST /api/v1/preview-session/{previewId}/revisions` | authenticated, owner-scoped |
| Delete session | `DELETE /api/v1/preview-session/{previewId}` | authenticated, owner-scoped |
| Serve preview | `GET /api/v1/preview/{previewId}/{path}` | authless capability URL |

Unknown sessions return `404`; sessions owned by another user return `403` on management routes.

## Authentication and CSRF boundary

Management requires a Better Auth session and ownership. Every unsafe management request must satisfy:

1. `Origin` equals the public origin that serves the editor and management API.
2. `Sec-Fetch-Site` equals `same-origin` when present.

The expected origin is resolved from `PREVIEW_MANAGEMENT_ORIGIN`, then `BETTER_AUTH_URL`, then the unified frontend fallback. This supports both a single-origin deployment and a split deployment where the parent frontend and API/editor use different origins.

`FRONTEND_URL` still controls credentialed CORS for the parent application. It is not used as a substitute for the editor/API origin in the CSRF check.

Safe methods and the serving capability route are outside this boundary. The serving route remains cookieless and responds with `Access-Control-Allow-Origin: *` without credentials.

## Raw request-body boundary

`formData()` materializes multipart data, so preview uploads have two pre-parse controls:

1. route middleware rejects a known `Content-Length` greater than the session byte budget plus bounded multipart overhead;
2. Bun enforces `API_MAX_REQUEST_BODY_BYTES` before Hono receives the request, including clients without a usable length header.

Declared and actual file sizes are still validated after parsing. These controls serve different purposes: the transport/route caps bound peak request memory, while the store checks enforce session and asset contracts.

## Protocol layers

1. **Fixed resources** — installation files resolved through `bundles/preview-fixed-resources.json`; no session upload.
2. **Session assets** — author media immutable under `{assetId}@{hash}` keys.
3. **Generated documents** — HTML and generated CSS/JS published as atomic incremental revisions.

The API validates keys, normalized paths, declared and actual sizes, aligned multipart parts, referenced assets, fixed-resource ids, file counts, and byte budgets.

## Session store and topology

The store is process-local and in-memory:

- restart invalidates sessions;
- the client recreates after management or serving `404`;
- quotas are per process;
- multi-replica deployment requires coherent affinity for create, management, and serving;
- unconfirmed multi-replica configuration emits an operational warning.

Project data remains in the editor. Preview sessions are disposable render state.

## Atomic revisions

Assets are immutable. Generated documents and the complete asset/fixed reference maps are validated before a synchronous publication block. A reader observes revision N or N+1, never a partial mixture. Failed publication leaves revision N active.

## Serving behavior

Resolution order:

```text
generated document → session asset reference → fixed-resource reference → 404
```

A bare capability URL redirects with a relative `302` to the entry document.

Range behavior for session assets:

- satisfiable single range → `206`;
- valid but unsatisfiable single range, including `bytes=-0` → `416`;
- malformed, multi-range, non-`bytes`, or inverted range → ignored, full `200`.

Assets support ETag and `If-None-Match`.

## Response security policy

Every serving response, including errors, includes hardening headers:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Access-Control-Allow-Origin: *
```

HTML, SVG, XML, `text/xml`, and XHTML from every layer receive the canonical sandbox-first CSP. Cache policy is layer-specific:

- generated document: `no-store`;
- session asset: `no-cache`, ETag, optional Range;
- fixed resource: `private, max-age=31536000`;
- error: `no-store`.

Preview ids are redacted from durable audit paths.

## External media

The preview uses the synchronized eXeLearning shim, relay, media policy, and media host described by ADR-0033. The untrusted child reports maintained-provider identifiers and geometry; the trusted parent reconstructs canonical URLs and clamps overlays to the content rectangle.

## Activation status

The adapter is implemented and tested, but browser activation requires an eXeLearning core artifact containing `HttpPreviewProvider` and `bundles/preview-fixed-resources.json`. Bootstrap-string and API tests do not prove activation with an older bundled editor.

The final integration gate is a reproducible browser test covering:

```text
create → assets → revision → opaque capability iframe → incremental update → cleanup
```

## Conformance and tests

The adapter replays vendored core vectors. Additional tests cover:

- authentication and ownership;
- split frontend/API origins and Fetch Metadata;
- script-breakout payloads in bootstrap query values;
- pre-parse request-length rejection and transport cap resolution;
- capability CORS isolation;
- multipart alignment and size validation;
- Range, ETag, redirect, CSP, expiry, and cleanup;
- fixed-resource containment;
- audit redaction and store topology.

When this document conflicts with the canonical core contract, the core contract wins and the adapter must be updated.
