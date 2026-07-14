# ADR-0029 Use complete snapshots for opaque embedded editor previews

* Status: Accepted
* Date: 2026-07-14
* Agents involved: Security, API services, interoperability, and QA

## Context and problem

The embedded editor must execute official and authored eXeLearning JavaScript
without exposing the authenticated Procomún origin. The previous proposal grew
into a layered revision protocol with fixed resources, manifests, deltas, and
media relays. Those mechanisms are not required when the editor can already
generate a complete HTML preview package.

## Options considered

* Keep the layered preview protocol v2.
* Inline every resource into `srcdoc`.
* Upload and replace one complete short-lived ZIP snapshot.

## Decision

Use a project- and owner-scoped management route to replace a complete ZIP
snapshot and an authless, expiring capability route to serve its files. The
preview iframe remains opaque and has no same-origin permission. The normal
eXeLearning editor preview is not routed through this host transport.

## Consequences

### Positive

* The host contract is small and auditable.
* Official and authored preview code retains normal multi-file behaviour.
* Authentication and CSRF checks stay on management operations only.
* Capability responses cannot read Procomún cookies or storage.

### Negative / risks

* Every refresh transfers a complete snapshot.
* Capabilities remain bearer credentials until deletion or expiry.
* The in-memory store requires sticky routing or replacement by a shared store
  for multi-replica deployments.
* Opaque sandboxing does not prevent all network requests or social engineering.

## Implementation notes

Keep path, ZIP, MIME, ownership, same-origin request, TTL, and response-header
tests beside the implementation. Do not log preview IDs or preview contents.
