# Validation — Épica 005: versionado de recursos

## 2026-08-11 — Validación del MVP (issue #31 / ADR-0039)

Validación automatizada con `bun test` (regla 14 de AGENTS.md). Evidencia por requisito:

| Requisito | Evidencia (test) |
|-----------|------------------|
| RF-001 publicar nueva versión sin perder la anterior | `resource-versions.integration.test.ts` («publicar una segunda versión incrementa el número y conserva la anterior»); `versions.unit.test.ts` (POST 201) |
| RF-002 misma URL/identificador | `elpx-versioning.unit.test.ts` («la ficha pública sirve la previsualización y descarga de la versión vigente» — mismo slug) |
| RF-003 notas de cambio | `versions.unit.test.ts` (historial con `changeNotes`) |
| RF-004 historial con fecha/autor/notas | `resource-versions.integration.test.ts` («historial: autor, fecha y notas quedan registrados») |
| RF-005 vigente distinguida | `isCurrent` en historial (integration + unit) |
| RF-006 descarga de versiones previas | `versions.unit.test.ts` (`downloadUrl`); `elpx-versioning.unit.test.ts` (descarga pública sobrevive al reemplazo del media item) |
| RF-007 rollback no destructivo | `resource-versions.integration.test.ts` («restaurar crea una versión nueva…», «restaurar aplica el snapshot a la proyección»); `versions.unit.test.ts` (curador restaura; autor 403) |
| RF-008 sin duplicados en búsqueda/feeds | Por construcción: solo se indexa/expone la proyección `resources` (sin cambios de contrato); resolución vigente cubierta por tests de ficha pública |
| RF-009 política de retención | Documentada en ADR-0039 (conservar todo; purga explícita futura); protección activa validada en `elpx-retire.unit.test.ts` y `elpx-versioning.unit.test.ts` |
| RF-010 auditoría | Rutas registran `resource_version_published` / `resource_version_restored` (logActivity, fire-and-forget) |
| Concurrencia (ADR-0032 §3) | «dos publicaciones concurrentes obtienen números distintos y consecutivos»; «UNIQUE(resource_id, version_number) impide duplicados» |
| Integridad del historial | «no se puede borrar un elpx_project referenciado por una versión» (FK RESTRICT); guardas de retirada («conserva proyecto…», «conserva archivo y sesión…») |
| Identificadores eXeLearning | `elpx-metadata.unit.test.ts` (odeId/odeVersionId/exe_version) |

Comandos ejecutados: `bun run check-types` (0 errores), `bun run lint` (sin errores nuevos), `bun run test` (suite completa unit + integration + paridad archivo-test + cobertura).
