# Preview Serving Contract v2 — Host-Served Opaque HTTP Preview

Procomún implements the eXeLearning **Preview Serving Contract v2** so the
embedded editor can render the **editor preview of untrusted author HTML/JS** in
a browser-enforced **opaque origin** over a real HTTP capability URL — instead of
the lower-fidelity `srcdoc` fallback.

This is a per-host **adapter** of the single source of truth in eXe core:

- Canonical contract: eXe core `doc/development/preview-serving-contract.md`
- Isolation policy (verbatim CSP): eXe core `src/shared/security/previewSandbox.ts` → `previewCspHeader()`
- Reference store/serving: eXe core `src/services/preview-session-manager.ts`,
  `preview-serving.ts`, `preview-fixed-resources.ts`

Procomún already serves **published** `.elpx` content in an opaque origin
(ADR-0026) via `apps/api/src/routes/elpx-content.ts` (Hono, `/api/v1/elpx/:hash/*`).
The **editor preview** is the same idea applied to the authoring flow: served
from a short-lived **preview session** instead of a published upload.

Because Procomún is TypeScript/Bun like eXe core, it mirrors core's
`previewCspHeader()` string and the `preview-session-manager` semantics directly,
rather than reimplementing them in a foreign runtime as the PHP hosts
(Moodle/WordPress/Omeka) do.

**Protocol version: 2.** Version 1 (full SHA-256 manifest + content-addressed
blob diff) was never consumed by a shipped host editor and is removed, not kept
alongside. A client that receives a create-session response without
`protocolVersion: 2` must surface an error (no silent fallback).

## Why v2 (the incremental model)

Protocol v1 treated every refresh as a full export: the client re-hashed the
whole file set, serialized a full manifest, and the server re-hashed every
uploaded blob into a per-session content-addressed store — `O(total project
size)` per one-word edit, dominated by project media and by installation files
(libraries, themes, iDevice runtimes) that are identical for every project.

v2 splits the preview into **three layers with different lifecycles** so a
refresh costs `O(invalidated documents + new assets)`:

| Layer | Contents | Lifecycle | Transferred |
|---|---|---|---|
| **Fixed installation resources** | official libraries, iDevice runtimes, base theme files, PDF.js, content CSS, logo, bundled fonts | immutable per installed editor version | **never** — served from the installed static editor, gated by a build manifest |
| **Session project assets** | author images/audio/video/PDF/attachments | immutable per `assetKey`; live for the whole preview session | **once per session** (again only if replaced → new key) |
| **Generated documents** | page HTML, navigation, generated CSS/JS, user-theme/iDevice files | change with every edit | **only the changed files**, as an atomic revision delta |

Implementation:

- Session store (three layers, atomic revisions, TTL, budgets, LRU):
  [`apps/api/src/services/preview-session-store.ts`](../apps/api/src/services/preview-session-store.ts)
- Fixed-resource resolver (manifest-gated, containment-checked):
  [`apps/api/src/services/preview-fixed-resources.ts`](../apps/api/src/services/preview-fixed-resources.ts)
- HTTP routes (management + serving):
  [`apps/api/src/routes/preview.ts`](../apps/api/src/routes/preview.ts)

## How the editor activates it

The embedded-editor bootstrap (`apps/api/src/routes/exelearning-editor.ts`)
injects a `previewHttp` block into `window.__EXE_EMBEDDING_CONFIG__`. The core
editor's `HttpPreviewProvider` reads it to drive the management API and point the
opaque preview iframe at the serving base:

```jsonc
{
  "previewHttp": {
    "protocolVersion": 2,
    "managementBaseUrl": "/api/v1/preview-session", // owner-gated, session cookie
    "servingBaseUrl": "/api/v1/preview"             // authless capability URL
  }
}
```

Auth is the **same-origin better-auth cookie**: the core client sends
`credentials: 'same-origin'` on management requests, so Procomún needs **no**
`managementHeaders`/`managementQuery` (there is no CSRF token — SameSite cookie +
CORS allowlist only). Both URLs are root-relative, so the editor's injected
`<base>` does not rewrite them.

There is **no silent fallback**: if the endpoint is missing or answers with the
wrong `protocolVersion`, the editor surfaces an error rather than downgrading to
a same-origin document.

> **Activation dependency.** The bundled static editor (v4.0.1) predates the core
> `HttpPreviewProvider` and still uses the legacy transport, so these HTTP v2
> routes are served and tested but **not yet driven by a real editor**. Real
> activation requires a core release shipping `HttpPreviewProvider` and the
> `bundles/preview-fixed-resources.json` manifest (the `Dockerfile` pulls the
> latest `exelearning/exelearning` release). The `previewHttp` wiring is in place
> so activation is just that release bump. See
> [ADR-0030](negocio/decisiones/0030-topologia-store-preview-http.md).

## The fixed-resource manifest

The installed static editor ships `bundles/preview-fixed-resources.json` (under
`apps/api/static/exelearning-editor/static`). It is the **only** authority for
what the serving route may resolve outside a session:

```jsonc
{
  "schemaVersion": 1,
  "buildVersion": "<editor version at build time>",
  "resources": {
    // fixedResourceId → { path (relative to the distribution root), size }
    "libs/jquery/jquery.min.js": { "path": "libs/jquery/jquery.min.js", "size": 89476 },
    "theme:base/icon.svg":       { "path": "files/perm/themes/base/base/icon.svg", "size": 71 }
  }
}
```

- The resolver resolves a `fixedResourceId` by **exact map lookup** — client
  input never becomes a path — and reads `resources[id].path` under the
  distribution root with lexical **and** symlink containment checks.
- Unknown ids are a lookup miss, never a filesystem probe; a revision that
  references one is rejected `422 unknown-fixed-resources`.
- A **missing or invalid manifest is non-fatal**: the fixed layer is simply
  disabled (revisions carrying `fixedRefs` get a 422 and the client demotes those
  paths to document writes), warned about once. Until the static editor build
  emits the manifest for protocol v2, the fixed layer stays off and everything
  rides the session layers.

## Management API (session-authenticated, owner-scoped)

Mounted at `/api/v1/preview-session`; the `sessionMiddleware` guard is applied
for `/api/v1/preview-session/*` in `app/middleware.ts` (mirroring
`/api/v1/tokens/*`). A user may only touch their **own** sessions (403 otherwise,
404 for unknown ids). Owner ids are better-auth string user ids.

| Method & path | Body | Success response |
|---|---|---|
| `POST /api/v1/preview-session` | – | `201` `{ previewId, protocolVersion: 2, revision: 0, limits: { maxFilesPerSession, maxBytesPerSession, maxAssetBytes, recommendedBatchBytes } }` |
| `POST /api/v1/preview-session/:previewId/assets` | multipart: `assets` (JSON `[{ key, size }]`), `files[]` (index-aligned) | `200` `{ stored, alreadyStored, rejected }` |
| `POST /api/v1/preview-session/:previewId/revisions` | multipart: `revision` (JSON, below), `files[]` (index-aligned with `writes`) | `200` `{ revision, active: true }` |
| `DELETE /api/v1/preview-session/:previewId` | – | `200` `{ success: true }` |

- **Assets.** `key` must match `^[0-9a-fA-F-]{36}@[0-9a-f]{8,64}$` (project asset
  id + content-hash prefix); the server validates the shape and treats the key as
  an opaque token — it never hashes. Keys are **immutable**: re-uploading a held
  key reports it in `alreadyStored` and does **not** replace the bytes (replaced
  author files get a new key). The byte budget is enforced twice — on declared
  sizes before buffering, on actual bytes while buffering.
- **Revisions.** The `revision` JSON field:

  ```jsonc
  {
    "baseRevision": 17,        // the revision the client believes is active
    "nextRevision": 18,        // must be baseRevision + 1
    "writes": ["index.html"],  // aligned with files[]
    "deletes": ["html/old.html"],
    "assetRefs": { "content/resources/photo.png": "<assetKey>" },  // FULL map
    "fixedRefs": { "libs/jquery/jquery.min.js": "libs/jquery/jquery.min.js" }  // FULL map
  }
  ```

  Validation order: session exists (`404`) → `baseRevision` equals the active
  revision **and** `nextRevision` is `baseRevision + 1`, else
  `409 { reason: "revision-conflict", currentRevision }` → every path safe, else
  `400` → every `assetRefs` value stored, else
  `422 { reason: "missing-assets", missing }` → every `fixedRefs` value in the
  manifest, else `422 { reason: "unknown-fixed-resources", resources }` → file
  count / byte budgets, else `413`. All bytes are buffered first, then the store
  publishes documents + both ref maps + the revision number in **one synchronous
  swap**, so a concurrent `GET` observes revision *N* or *N+1*, never a mixture.
  Until the first revision publishes, the serving route 404s every path.
- **Budgets & TTL.** Per-session file-count and byte caps, a per-asset cap, a
  global cap with LRU eviction, per-user session caps, and an idle-TTL sweeper.
  Reference defaults: 30-min idle TTL, 4 sessions/user, 5000 files/session,
  200 MiB/session, 128 MiB/asset, 2 GiB global. All overridable via the
  `PREVIEW_*` env knobs.

## Serving route (authless capability URL)

```
GET /api/v1/preview/{previewId}          → 302 redirect to {previewId}/index.html
GET /api/v1/preview/{previewId}/         → 302 redirect to {previewId}/index.html
GET /api/v1/preview/{previewId}/*        → the previewed file
```

- **Bare-URL redirect.** The bare capability URL (and its trailing-slash form)
  answers `302 Location: …/{previewId}/index.html` — it never serves the index
  bytes inline. This keeps the iframe's relative-URL base at `…/{previewId}/` so
  the entry document's sub-resources resolve correctly. The `Location` is an
  absolute path (trailing slash trimmed) so a trailing slash cannot double the id.
- **Cookieless capability URL.** The opaque iframe sends no SameSite cookie, so
  the route must not depend on the auth cookie. It is gated purely on the
  unguessable server-minted `previewId` (a v4 UUID) + an idle TTL — the same
  authless model as the published `/api/v1/elpx/:hash/*` route. The serving path
  is deliberately **not** listed in `sessionProtectedApiPatterns`.
- `previewId` **must** match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
  anything else → 404. (Stricter than the elpx route's `HASH_PATTERN`, which also
  accepts SHA-1.)
- **Resolution order** (exact-key lookups against the **active revision** only):
  `documents[path]` → `assets[assetRefs[path]]` → `manifest[fixedRefs[path]]` →
  404. Client input never reaches the filesystem; only manifest-listed,
  containment-checked paths do.
- **Range requests.** Session-asset responses advertise `Accept-Ranges: bytes`
  and honor a **single** `bytes=` range (`206`). A **valid** single range that is
  unsatisfiable (first-byte-pos at/past EOF, or a zero-length suffix `bytes=-0`)
  answers `416`. A header that is **malformed, multi-range, non-`bytes`-unit, or
  an invalid spec** (`bytes=5-2`, last-byte-pos < first-byte-pos per RFC 9110) is
  **ignored** — a normal `200` full response, not a `416`. Documents and fixed
  resources ignore Range entirely.
- **Conditional requests.** Session-asset responses carry `ETag: "<assetKey>"`
  and answer `If-None-Match` with `304`.

## Required response headers (on every response, including 404s)

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Access-Control-Allow-Origin: *          (authless + cookieless; NEVER with credentials)
Content-Type: <the file's real MIME type>
```

`Cache-Control` is **tiered by layer** — not `no-store` uniformly:

| Response | Cache-Control |
|---|---|
| Generated document (layer 3) | `no-store` |
| Session project asset (layer 2) | `no-cache` (+ `ETag`, honor `If-None-Match`) |
| Fixed installation resource (layer 1) | `private, max-age=31536000` |
| 404 / errors | `no-store` |

> Note the deltas vs. the **published** elpx route: preview uses
> `Referrer-Policy: no-referrer` (published uses `same-origin`) and a **stricter**
> CSP profile. Do not reuse `elpx-content.ts`'s CSP for the preview.

On **every scriptable document type** — `text/html`, **`image/svg+xml`**,
`application/xml`, `text/xml`, `application/xhtml+xml` — from **any** resolution
layer (session or fixed), additionally emit the sandbox-first CSP **verbatim**
(an author SVG opened top-level runs its inline `<script>` same-origin without it;
`nosniff` does not help — SVG is already scriptable):

```
Content-Security-Policy:
  sandbox allow-scripts allow-popups allow-forms;
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  media-src 'self' data: blob: https:;
  font-src 'self' data:;
  connect-src 'self';
  frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com;
  child-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com;
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-ancestors 'self';
```

This string **must stay byte-identical** to eXe core `previewCspHeader()` (single
line joined by `; `, no trailing `;`). It is **stricter** than Procomún's
published-content CSP (which allows `frame-src https:`, `base-uri 'self'`, and
`allow-popups-to-escape-sandbox`) — the preview must use the strict core string.

## Deployment topology (in-memory store)

Preview sessions live in the `app` process's memory and are not persisted; they
die on restart and the client recreates them transparently on the next refresh
(any `404` triggers a re-prepare). Global limits are **per process**. Production
is single-replica today, so the in-memory store is correct as-is. A multi-replica
deployment needs **sticky routing keyed on the `previewId` path segment** for both
management and serving (with the session `CREATE` pinned to its owning replica).
The full rationale, the `nginx` example, and the `PREVIEW_MULTI_REPLICA` /
`PREVIEW_STICKY_ROUTING_CONFIRMED` startup guard are in
[ADR-0030](negocio/decisiones/0030-topologia-store-preview-http.md) and
[`docs/operaciones/preview-sessions.md`](operaciones/preview-sessions.md).

## Conformance

Beyond the byte-identical CSP assertion in the route unit tests, this adapter
replays the shared contract vectors vendored from core at
[`apps/api/test/preview-contract/vectors.json`](../apps/api/test/preview-contract/vectors.json)
in [`apps/api/src/routes/preview-contract.unit.test.ts`](../apps/api/src/routes/preview-contract.unit.test.ts):
a canned session (assets + a revision + a conflict + traversal and scriptable-SVG
probes) with the expected status codes and headers, so protocol semantics — not
just the CSP string — stay aligned across hosts. Refresh the JSON from core; do
not fork it.
