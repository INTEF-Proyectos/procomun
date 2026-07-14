# Simplified opaque preview contract

Procomún isolates rendered eXeLearning editor previews from the authenticated
application with a sandboxed iframe that omits `allow-same-origin`. The editor
uploads one complete ZIP snapshot per refresh; the host does not implement
layers, revisions, deltas, fixed-resource manifests, or external-media overlays.

## Management route

`POST /api/v1/preview-sessions/{resourceId}` accepts multipart form data with a
`snapshot` ZIP and an optional `previewId`. It requires a valid user session, a
same-origin `Origin` header, and permission to manage the resource. A successful
request returns an unguessable capability ID and its serving URL. Supplying an
existing ID replaces the complete snapshot atomically.

`DELETE /api/v1/preview-sessions/{resourceId}/{previewId}` applies the same
authentication, origin, ownership, and resource-scope checks.

## Serving route

`GET /exe-preview/{previewId}/{path}` is deliberately authless. The capability
ID is the credential, expires after 30 minutes of inactivity, and is never
written to audit logs. Paths are decoded once and rejected if they are absolute,
contain backslashes, empty segments, `.` or `..`.

Scriptable responses (`text/html`, SVG, XML, and XHTML) receive a CSP `sandbox`
directive without `allow-same-origin`. Every response, including errors, uses
`nosniff`, `no-referrer`, `no-store`, a restrictive Permissions Policy, and
credential-free CORS for opaque-origin subresource loads.

## Snapshot limits

Uploads are limited to 25 MiB compressed, 5,000 files, and 100 MiB
uncompressed. The ZIP central directory is validated before extraction to reject
traversal, absolute paths, symlinks, ZIP64, and suspicious compression ratios.

The current store is process-local. Deployments with multiple API replicas need
sticky routing or a shared implementation of this same full-snapshot contract;
that operational limitation does not justify reintroducing protocol v2.
