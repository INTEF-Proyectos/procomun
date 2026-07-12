# HTTP editor preview — Procomún adapter

Procomún implements eXeLearning **Preview Serving Contract v2** for the embedded editor. The canonical protocol, CSP, scriptable MIME set, bridge files, and conformance vectors live in eXeLearning core. This document records the Procomún mapping and operational constraints.

The authored preview runs in an iframe without `allow-same-origin`. Scriptable responses also receive the sandbox-first CSP, so a capability URL remains opaque when opened directly.

There is no authored-content `srcdoc` transport and no implicit Service Worker fallback. Missing or invalid `previewHttp` configuration fails closed.

## Transport configuration

`apps/api/src/routes/exelearning-editor.ts` injects:

```jsonc
{
  "previewHttp": {
    "protocolVersion": 2,
    "managementBaseUrl": "/api/v1/preview-session",
    "servingBaseUrl": "/api/v1/preview"
  }
}
```

Management requests use `credentials: "same-origin"`. Serving requests use `credentials: "omit"`.

## Endpoint mapping

| Operation | Route | Trust model |
|---|---|---|
| Create session | `POST /api/v1/preview-session` | authenticated, origin-validated |
| Upload assets | `POST /api/v1/preview-session/{previewId}/assets` | authenticated, origin-validated, owner-scoped |
| Publish revision | `POST /api/v1/preview-session/{previewId}/revisions` | authenticated, origin-validated, owner-scoped |
| Delete session | `DELETE /api/v1/preview-session/{previewId}` | authenticated, origin-validated, owner-scoped |
| Serve preview | `GET /api/v1/preview/{previewId}/{path}` | authless capability URL |

Unknown sessions return `404`; sessions owned by another user return `403`.

## Authentication and CSRF boundary

Management requires a Better Auth session and session ownership. `SameSite=Lax` is pinned explicitly as defense in depth, but it is not the application-level CSRF boundary.

Every unsafe preview-management request must satisfy:

1. `Origin` exactly equals the configured frontend origin.
2. `Sec-Fetch-Site` equals `same-origin` when the browser sends Fetch Metadata.

This rejects foreign origins and sibling subdomains even when they are same-site. Missing or invalid `FRONTEND_URL` fails closed for preview mutations.

Safe methods and the authless serving capability route are outside this check. The serving route must remain accessible to the opaque iframe with `Origin: null` and no credentials.

The app-wide credentialed CORS middleware is skipped only for `/api/v1/preview/*`, preserving `Access-Control-Allow-Origin: *` without `Access-Control-Allow-Credentials`. Management retains the credentialed frontend-origin CORS policy.

## Protocol layers

1. **Fixed resources** — official editor resources resolved through `bundles/preview-fixed-resources.json`; never uploaded into a session.
2. **Session assets** — author images, audio, video, PDF, and attachments; immutable per `{assetId}@{hash}` key and uploaded once per session.
3. **Generated documents** — page HTML and generated CSS/JS; only changed files are sent as an atomic revision delta.

The API validates asset keys, paths, declared sizes, actual sizes, aligned multipart parts, referenced assets, fixed-resource IDs, file counts, and byte budgets.

## Session store and topology

The current store is process-local and in-memory. This matches the documented single-replica production topology.

Consequences:

- a process restart invalidates active preview sessions;
- the client recreates a session after a management or serving `404`;
- quotas are per process;
- a multi-replica deployment requires sticky routing for create, management, and serving;
- multi-replica mode without confirmed affinity emits an operational warning.

The store is not a durable project store. Project data remains in the editor; preview sessions are disposable render state.

### Memory considerations

Multipart assets are currently parsed and materialized in memory before being inserted into the process-local store. Default limits must therefore be sized against real RSS and external-memory measurements rather than treated as a safe target.

Before increasing limits or replica concurrency, measure:

- one large asset;
- a full legal batch;
- four sessions owned by one user;
- multiple concurrent users;
- temporary `FormData`/`ArrayBuffer` copies;
- cleanup and process restart.

A future implementation may spool large assets to private temporary storage without changing the wire protocol.

## Atomic revisions

Assets are immutable under validated keys. Generated documents and complete asset/fixed reference maps are published synchronously as one new revision state.

The active revision changes only after all input validation and buffering succeed. Missing multipart parts are rejected before publication. A reader observes revision N or N+1, never a partially updated map.

## Serving behavior

Resolution order for the active revision:

```text
generated document → session asset reference → fixed-resource reference → 404
```

A bare capability URL redirects with a relative `302` target to `{previewId}/index.html`, preserving the correct base for relative resources.

Range behavior for session assets:

- valid satisfiable single range → `206`;
- valid unsatisfiable single range, including `bytes=-0` → `416`;
- malformed, multi-range, non-`bytes`, or inverted range → ignore and return the full `200` response.

Assets support ETag and `If-None-Match`.

## Response security policy

Every response, including errors, includes:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Access-Control-Allow-Origin: *
```

`Access-Control-Allow-Origin: *` is used only by the cookieless serving route and is never paired with credentials.

HTML, SVG, XML, `text/xml`, and XHTML from every layer receive the byte-identical sandbox-first CSP defined by eXeLearning core. The iframe sandbox omits `allow-same-origin`.

Cache policy is layer-specific:

- generated document: `no-store`;
- session asset: `no-cache`, ETag, optional Range;
- fixed resource: `private, max-age=31536000`;
- error: `no-store`.

Preview capability IDs are redacted from durable audit paths.

## External media

The embedded preview uses the synchronized eXeLearning shim, relay, media policy, and media host. Core is the canonical source.

The untrusted child reports maintained-provider identifiers and geometry. The trusted parent reconstructs canonical provider URLs and clamps overlays to the content rectangle.

## Activation status

The host adapter is implemented and tested, but the released editor currently bundled by Procomún predates `HttpPreviewProvider`. Production activation requires a core editor release containing:

```text
HttpPreviewProvider
StaticServiceWorkerPreviewProvider
bundles/preview-fixed-resources.json
```

Until that editor is installed, the released client ignores `previewHttp`. Bootstrap-string and API tests do not by themselves prove browser activation.

The final integration gate is a browser test using one reproducible static-editor artifact from the target core commit, demonstrating create → assets → revision → opaque capability iframe → incremental update → cleanup.

## Conformance and tests

The Procomún harness replays an exact vendored copy of the core vectors. Additional tests cover:

- session authentication and ownership;
- exact-origin and Fetch Metadata rejection;
- capability-route CORS isolation;
- malformed and missing multipart input;
- Range, ETag, bare-root redirect, CSP, expiry, and cleanup;
- fixed-resource containment;
- audit-log capability redaction;
- store topology configuration.

When this document conflicts with the canonical core contract, the core contract wins and the adapter must be updated.