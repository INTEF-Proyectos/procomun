# Preview Serving Contract — Host-Served Opaque HTTP Preview

Procomún implements the eXeLearning **Preview Serving Contract** so the embedded
editor can render the **editor preview of untrusted author HTML/JS** in a
browser-enforced **opaque origin** over a real HTTP capability URL — instead of
the lower-fidelity `srcdoc` fallback.

This is a per-host **adapter** of the single source of truth in eXe core:

- Canonical contract: eXe core `doc/development/preview-serving-contract.md`
- Isolation policy (verbatim CSP): eXe core `src/shared/security/previewSandbox.ts` → `previewCspHeader()`

Procomún already serves **published** `.elpx` content in an opaque origin
(ADR-0026) via `apps/api/src/routes/elpx-content.ts` (Hono, `/api/v1/elpx/:hash/*`).
The **editor preview** is the same idea applied to the authoring flow: served
from a short-lived **preview session** instead of a published upload.

Because Procomún is TypeScript/Bun like eXe core, it can mirror core's
`previewCspHeader()` string and the `preview-session-manager` contract directly
(a shared package or a byte-checked copy), rather than reimplementing it in a
foreign runtime as the PHP hosts (Moodle/WordPress/Omeka) do.

## Why HTTP, not the Service Worker

The preview renders author-provided scripts. Same-origin, that content can read
the editor DOM, the session/`auth` cookie surface, IndexedDB, and — in the
embedded editor — the Procomún admin origin. The fix is an opaque origin: a
document served with a response-level `Content-Security-Policy: sandbox …` (no
`allow-same-origin`). A Service Worker **cannot** back an opaque iframe (its
subresources bypass the SW). **Never serve the preview same-origin, and never via
a Service Worker.**

## How the editor activates it

```jsonc
{
  "embeddingConfig": {
    "previewTransport": "http",
    "previewBasePath": "/api/v1/preview"
  }
}
```

There is **no silent fallback**: if `http` is selected and the endpoint is
missing, the editor surfaces an error rather than downgrading to a same-origin
document.

## Serving route (authless capability URL)

```
GET /api/v1/preview/{previewId}/*        → the previewed file
```

Reference endpoint: [`apps/api/src/routes/preview.ts`](../apps/api/src/routes/preview.ts).

- **Cookieless capability URL.** The opaque iframe sends no SameSite cookie, so
  the route must not depend on the auth cookie. It is gated purely on the
  unguessable server-minted `previewId` (a v4 UUID) + an idle TTL — the same
  authless model as the published `/api/v1/elpx/:hash/*` route.
- `previewId` **must** match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
  anything else → 404. (Note this is stricter than the elpx route's
  `HASH_PATTERN`, which also accepts SHA-1 hashes.)
- Resolve the path from the session's **active** manifest only; unknown/traversal
  paths → 404. Exact-key lookup in the store, never the real filesystem.

## Required response headers (on every response, including 404s)

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Access-Control-Allow-Origin: *          (authless + cookieless; NEVER with credentials)
Content-Type: <the file's real MIME type>
```

> Note the deltas vs. the **published** elpx route: preview uses
> `Referrer-Policy: no-referrer` (published uses `same-origin`) and a **stricter**
> CSP profile (see below). Do not reuse `elpx-content.ts`'s CSP for the preview.

On **every scriptable document type** — `text/html`, **`image/svg+xml`**,
`application/xml`, `application/xhtml+xml` — additionally emit the sandbox-first
CSP **verbatim** (an author SVG opened top-level runs its inline `<script>`
same-origin without it; `nosniff` does not help — SVG is already scriptable):

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
Add a drift check (mirror `check-embed-sync`).

## Follow-up (not in this reference)

The reference endpoint stubs the **preview session store** and the authenticated
**management API** (`POST /api/v1/preview-session`, `/:id/manifest`, `/:id/blobs`,
`DELETE /:id`) with a clear TODO. A production implementation mirrors eXe core's
`preview-session-manager.ts` semantics (content-addressed blobs, server-side
re-hash, atomic manifest swap, per-session/global byte budgets, idle-TTL sweeper)
— ideally as a shared TS package rather than a reimplementation — plus its
colocated unit tests.
