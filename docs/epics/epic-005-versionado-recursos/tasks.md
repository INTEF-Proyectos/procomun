# Tasks — Épica 005: versionado de recursos

## MVP — issue #31 / ADR-0039
- [x] Crear `resource_versions` y `resources.current_version_id`.
- [x] Permitir varios `elpx_projects` por recurso y proteger los referenciados por historial.
- [x] Crear automáticamente una versión en upload, save y generate de `.elpx`.
- [x] Mantener historial con número, fecha, autor, vigente y descarga.
- [x] Implementar restauración no destructiva para curador/admin.
- [x] Resolver la ficha pública mediante la versión vigente.
- [x] Eliminar notas de versión y la acción/API manual de «publicar nueva versión».
- [x] Mover la migración de versionado a `0007_resource_versions.sql` para convivir con `0006_user_email_case_insensitive` de `main`.
- [x] Actualizar ADR-0039 y pruebas al flujo automático.

## Posterior
- [ ] Política configurable de retención y GC.
- [ ] Purgado administrativo explícito.
- [ ] Diff visual opcional.
