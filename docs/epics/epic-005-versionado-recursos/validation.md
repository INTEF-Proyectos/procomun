# Validation — Épica 005: versionado de recursos

## Criterios
| Requisito | Evidencia automatizada |
|---|---|
| Nueva entrega crea versión automáticamente | `elpx-versioning.unit.test.ts` |
| No existe publicación manual de versiones | `versions.unit.test.ts` |
| Historial sin notas de versión | `versions.unit.test.ts`, `resource-versions.integration.test.ts` |
| Versiones consecutivas y vigente | `resource-versions.integration.test.ts` |
| Restauración no destructiva | `versions.unit.test.ts`, `resource-versions.integration.test.ts` |
| ELPX históricos protegidos | `resource-versions.integration.test.ts`, `elpx-retire.unit.test.ts` |
| Metadatos ELPX adicionales | `elpx-metadata.unit.test.ts` |
| Cliente frontend sin publish/changeNotes | `resource-version-api.unit.test.ts` |
| API pública no expone versiones históricas (RF-008 / #323) | `public-version-access.unit.test.ts`, `resource-versions.integration.test.ts` |
| Preview histórica autenticada con sandbox | `public-version-access.unit.test.ts`, `ResourceVersionPanel.unit.test.tsx` |

La validación completa se delega al CI del PR: tests, typecheck, lint y checks de tracking deben ejecutarse sobre la rama ya actualizada con `main`.
