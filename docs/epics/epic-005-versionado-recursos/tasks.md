# Tasks — Épica 005: versionado de recursos

## 2026-08-11 — Implementación MVP (issue #31 / ADR-0038)

- [x] T1. Esquema: tabla `resource_versions`, columna `resources.current_version_id`, retirada del `UNIQUE(resource_id)` de `elpx_projects` (Drizzle + `setup.ts` + migración `0006_resource_versions.sql`).
- [x] T2. Parser ELPX: extraer `odeId`, `odeVersionId` y `exe_version` de `content.xml`.
- [x] T3. Repositorio transaccional: `publishResourceVersion` (bloqueo + `MAX+1` + snapshot + puntero), `listResourceVersions`, `restoreResourceVersion` (no destructiva, aplica snapshot a la proyección), `getResourceVersionById`, `countVersionsReferencingElpxProject`, `isUploadSessionReferencedByVersions`.
- [x] T4. Resolución de proyecto elpx: vigente (`getCurrentElpxProjectByResourceId`, listados públicos) vs. copia de trabajo (orden determinista por `created_at`).
- [x] T5. API admin: `GET/POST /api/admin/resources/:id/versions`, `POST …/versions/:versionId/restore` (curador/admin), con auditoría (`resource_version_published`, `resource_version_restored`) y re-indexado FTS al restaurar.
- [x] T6. Protección del historial: FK `ON DELETE RESTRICT` + guardas `retireWorkingCopyProject` / `retireUploadArtifacts` en los flujos de reemplazo (`/api/admin/elpx/upload|save|generate`, borrado de media) y descarga pública tolerante a media items reemplazados.
- [x] T7. Frontend: panel «Historial de versiones» en la página de edición (publicar con notas, listado, descarga, restaurar).
- [x] T8. Documentación: ADR-0038, adenda de diseño, `validation.md`, `status.yaml`.

## Pendiente (fases posteriores)

- [ ] P1. Política de retención configurable y GC de almacenamiento (ADR-0032 como referencia).
- [ ] P2. Operación explícita de purgado (contenido ilegal / datos personales / retirada administrativa).
- [ ] P3. Exposición opcional del historial en API pública/OAI-PMH si se requiere.
- [ ] P4. Diff visual de metadatos entre versiones.
