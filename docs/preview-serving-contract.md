# Opaque editor preview — Procomún adapter

The embedded editor renders its preview **filtered** by default: sanitised, with no author JavaScript running. When the author opts in to running their own code, the editor needs somewhere to put the real project bytes that is **not** the Procomún page — a browser-enforced **opaque origin** the content cannot reach out of.

This API is that somewhere. The editor POSTs the whole project as one ZIP and gets back an unguessable capability id; the API serves that tree from an authless route under a sandbox CSP. Missing or invalid configuration **fails closed**: the filtered preview stays.

See [ADR-0035](negocio/decisiones/0035-preview-snapshot-en-lugar-de-protocolo-v2.md) for why the earlier layered protocol was retired, and [ADR-0038](negocio/decisiones/0038-topologia-store-preview-http.md) for the store topology.

## Transport configuration

`exelearning-editor.ts` injects into `window.__EXE_EMBEDDING_CONFIG__`:

```jsonc
"previewSnapshot": {
  "managementUrl":     "/api/v1/preview-session",
  "servingBaseUrl":    "/api/v1/preview",
  "deleteUrlTemplate": "/api/v1/preview-session/{previewId}"
}
```

No `previewUrl` is returned by the API: the client derives it from `servingBaseUrl` + `/{previewId}/index.html`, which keeps one source of truth for the URL shape.

## Endpoint mapping

| | Request | Result |
|---|---|---|
| Management | `POST /api/v1/preview-session` | multipart `snapshot=<zip>`, optional `previewId` → `{ previewId }` |
| Management | `DELETE /api/v1/preview-session/{previewId}` | drops the snapshot |
| Serving | `GET /api/v1/preview/{previewId}/{path}` | the snapshot, authless |

`previewId` is absent on the first refresh (mint a capability) and present afterwards (replace in place). A capability that is unknown (404) or owned by somebody else (403) is refused, so it cannot be claimed from another author.

## Authentication and CSRF boundary

Management requires a Better Auth session and ownership. Every unsafe management request must satisfy:

1. `Origin` equals the public origin that serves the editor and management API.
2. `Sec-Fetch-Site` equals `same-origin` when present.

The expected origin is resolved from `PREVIEW_MANAGEMENT_ORIGIN`, then `BETTER_AUTH_URL`, then the unified frontend fallback. This supports both a single-origin deployment and a split deployment where the parent frontend and API/editor use different origins.

`FRONTEND_URL` still controls credentialed CORS for the parent application. It is not used as a substitute for the editor/API origin in the CSRF check.

Safe methods and the serving capability route are outside this boundary. Serving carries no authentication at all: the unguessable id plus the idle TTL is the whole credential, which is what makes the origin opaque — an iframe pointed at this URL carries no Procomún session, so author code inside it has nothing to steal. It responds with `Access-Control-Allow-Origin: *` and never with credentials.

## Raw request-body boundary

`formData()` materializes multipart data, so preview uploads have two pre-parse controls:

1. route middleware rejects a known `Content-Length` greater than the snapshot byte budget plus bounded multipart overhead;
2. Bun enforces `API_MAX_REQUEST_BODY_BYTES` before Hono receives the request, including clients without a usable length header.

The archive is validated again after parsing. These controls serve different purposes: the transport/route caps bound peak request memory, while the archive checks enforce the snapshot contract.

## What an archive must survive

`preview-snapshot-archive.ts` is the trust boundary. Two passes, and the order matters:

1. Every entry is vetted **before anything is decompressed**: safe relative paths only (no absolute paths, backslashes, `.`/`..` segments, NUL bytes, drive letters or schemes), a supported compression method, the entry-count cap, and an `index.html` must be present. One bad entry rejects the **whole** archive.
2. Entries are inflated one at a time and the bytes that **actually come out** are counted against the byte cap. The uncompressed sizes in a ZIP's central directory are supplied by whoever built the archive, so pass 1's total is an early reject, never the enforcement — a zip bomb that under-reports itself is caught here.

The new file map only replaces the previous one once the whole archive has passed, so a rejected upload leaves a working preview exactly as it was.

## Snapshot store and topology

A snapshot is `path → bytes` plus its owner, held in this process's memory. Snapshots are **not** persisted: they die on restart and the client transparently recreates them on the next refresh (any 404 from the API or the serving route triggers a re-sync).

| Bound | Default | Env override |
|---|---|---|
| Idle TTL | 30 min | `PREVIEW_SESSION_TTL_MINUTES` |
| Snapshots per user | 4 (LRU-evicted) | `PREVIEW_MAX_SESSIONS_PER_USER` |
| Files per snapshot | 5000 | `PREVIEW_MAX_FILES_PER_SESSION` |
| Bytes per snapshot | 200 MiB | `PREVIEW_MAX_BYTES_PER_SESSION_MB` |
| Global | 2 GiB (LRU-evicted, then 413) | `PREVIEW_GLOBAL_MAX_BYTES_MB` |

Serving a snapshot pushes its idle clock back, so a preview in use never expires under the author. A sweeper reclaims idle snapshots every minute.

Limits are **per process**. A multi-replica deployment needs sticky routing keyed on the `previewId` segment for both the management and serving routes; setting `PREVIEW_MULTI_REPLICA` without `PREVIEW_STICKY_ROUTING_CONFIRMED` logs a startup warning. See `docs/operaciones/preview-sessions.md` and ADR-0038.

## Serving behavior

A requested path is normalized (percent-decoding, traversal rejection, empty path → `index.html`) and then looked up by **exact match** in the file map, so a path that survives normalization can only ever name an entry of the map — never a filesystem location.

The bare capability URL never serves `index.html` bytes: it answers `302` with a **relative** `Location`, byte-identical to eXe core — no trailing slash → `{previewId}/index.html`; trailing slash → `index.html`. Both land on `…/{previewId}/index.html` without doubling or dropping the id, which keeps the iframe's relative-URL base correct under any mount prefix.

Caching is tiered:

- a **scriptable** document (`text/html`, `image/svg+xml`, XML, XHTML) is `no-store` — it is rewritten on every refresh;
- everything else revalidates with `no-cache` + `ETag`, `Accept-Ranges: bytes`, `If-None-Match` → 304 and single-range 206/416, which is what lets a video inside the snapshot seek without a full re-download.

The ETag incorporates a publish sequence: a replacement keeps the capability id, so an ETag derived from the id alone would answer 304 with stale bytes after a refresh.

## Response security policy

Every response, 404s included, carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, the preview `Permissions-Policy` and `Access-Control-Allow-Origin: *` — sound only because the route is authless and cookieless, and never to be paired with credentials.

Every **scriptable** type also carries the sandbox-first CSP, which MUST stay **byte-identical** to eXe core's `previewCspHeader()`: a single line, directives joined by `"; "`, no trailing `;`. Not just HTML — an author-supplied SVG opened top-level runs its inline `<script>`, and `nosniff` does not help because SVG is already a scriptable type. It is intentionally stricter than the published-content CSP in `elpx-content.ts` (no `frame-src https:`, `base-uri 'none'`, no `allow-popups-to-escape-sandbox`).

## Activation status

`make download-exelearning-editor` installs the **published release** of the editor. The opaque preview activates only once that release reads `previewSnapshot`; until then the bootstrap keeps neutralizing the legacy Service Worker registration (so untrusted author content can never run same-origin on the Procomún origin) and the preview stays filtered. This is the intended fail-closed behavior, not a defect.

## Conformance and tests

- `preview-snapshot-archive.unit.test.ts` — path safety, entry caps, the missing-index guard, and the zip-bomb case proven with a forged archive that under-reports its own size.
- `preview-snapshot-store.unit.test.ts` — capability lifecycle, owner scoping, TTL, per-user and global budgets, ETag change on refresh.
- `preview.unit.test.ts` — the whole serving response contract, including the byte-identical CSP assertion.
- `exelearning-editor.unit.test.ts` — asserts the bootstrap emits `previewSnapshot` and that `previewHttp` / `protocolVersion` never reappear.
- `preview-snapshot-test-zip.unit.test.ts` — round-trips the fixture builder against the reader.
