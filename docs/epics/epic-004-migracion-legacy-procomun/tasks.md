# Tasks — Épica 004: importador de recursos legacy Procomún (.elpx)

## Estado
En desarrollo

## Fase 0 — Prerrequisitos
- [x] Corregir `METADATA_KEYS` en `packages/db/src/elpx-metadata.ts` (`pp_license`→license, `pp_lang`→language).
- [x] Endurecer `apps/api/src/services/elpx-fixtures.unit.test.ts` para exigir `license`/`language` no vacíos en todos los fixtures reales.
- [x] Añadir índice único parcial `(import_source, external_id)` a `resources` (schema Drizzle + `setup.ts` + migración `0004_resources_import_dedup_index.sql`).
- [x] Registrar ADR-0029 y actualizar `decision-log.yaml`.
- [x] Crear esta épica (`requirements.md`, `design.md`, `tasks.md`, `validation.md`).

## Fase 1 — Piloto (9 ejemplos de `ode-export/`)
- [x] Copiar fixtures versionadas: JSON a `packages/db/src/test-fixtures/legacy-procomun/`, `.elpx` a `apps/api/src/test-fixtures/elpx/` y (para el test de integración del CLI) a `apps/cli/src/test-fixtures/legacy-procomun/`. **Anonimizadas** (nombres/emails reales de docentes sustituidos por valores sintéticos, incluido el `pp_author` embebido en el ZIP de `1615293421477.elpx`) — ver nota de gobernanza de datos más abajo.
- [x] Implementar `packages/db/src/legacy-import/types.ts`.
- [x] Implementar `normalize-license.ts` + `.unit.test.ts`.
- [x] Implementar `normalize-language.ts` + `.unit.test.ts`.
- [x] Implementar `resource-type-map.ts` + `.unit.test.ts`.
- [x] Implementar `field-mapper.ts` + `.unit.test.ts` (orquesta los normalizadores, ambas generaciones de JSON).
- [x] Implementar `system-user.ts` + `.unit.test.ts` (usuario de sistema para `upload_sessions.ownerId`).
- [x] Implementar `packages/db/src/repository/legacy-import.ts` (`findLegacyResourceByExternalId`, `importLegacyResourceWithElpx`), test en `packages/db/src/repository.unit.test.ts`.
- [x] Implementar `apps/cli/src/commands/import-legacy-procomun.ts` (+ `.unit.test.ts` + `.integration.test.ts`), registrado en `apps/cli/src/index.ts` como `import:legacy-procomun`.
- [x] `bun test` en verde en `packages/db`, `apps/api`, `apps/cli` (783/783 tests del monorepo).
- [x] `bun run scripts/check-test-files.ts` sin incidencias sobre archivos nuevos.
- [x] Ejecutar `--dry-run` sobre los 9 ejemplos reales, revisar `informe_ingesta.json`: 8 importables, 1 bloqueado (licencia inválida), 0 errores.
- [x] Ejecución real sobre los 9 ejemplos (entorno temporal aislado en `/tmp`, nunca persistido ni comprometido a git): 8 recursos importados con `hasPreview: true`, licencias/idiomas correctos, tamaños de `.elpx` coincidentes con el origen. Entorno temporal eliminado tras la verificación.
- [x] Registrar resultados en `validation.md`.

### Nota de gobernanza de datos (2026-07-10)
Los JSON/`.elpx` de `ode-export/` contienen datos personales reales (nombres y emails de docentes). Antes de versionar cualquier fixture en git se pidió confirmación explícita al usuario, que optó por anonimizar. Se sustituyeron los campos `publicatorStr`/`publicatorNameStr`/`publicatorEmailStr`/`authorStr`/`lifecycleContributeStr` en los 4 JSON de fixtures, y el `pp_author` + referencias en `index.html`/`content/html/*.html` dentro del `.elpx` `1615293421477` (re-empaquetado con `zip`, verificado contra el pipeline real de `parseElpxMetadata`/`processElpxUpload` antes de sustituir el fixture). La ejecución real del importador sobre los 9 ejemplos originales (no anonimizados) se hizo solo en un entorno temporal en `/tmp`, con autorización explícita del usuario, y se eliminó por completo al terminar.

## Fase 2 — Muestreo ampliado (condicionada a disponibilidad de más datos de INTEF)
- [ ] Repetir el piloto con `--limit` incremental (100 → 1.000 → 10.000) si INTEF facilita más ejemplos.
- [ ] Medir tasas de error/warning antes de comprometerse al volumen completo.

## Fase 3 — Volumen real (condicionada a decisiones de negocio F2-08/F2-09 con INTEF)
- [ ] Ejecución por lotes con checkpoints de progreso.
- [ ] Disponibilidad de comando de rollback por `runId`.
- [ ] Ejecución sobre el dataset completo (~78.800 ODEs).

## Documentación
- [x] Actualizar `docs/producto/roadmap.md` (fila "Migración desde Procomún").
- [x] Actualizar `status.yaml` con la tarea de esta épica (`T-2026-07-10-001`).

## Ampliación — importador de usuarios legacy (2026-08-06)
- [x] Analizar el formato real `exportados-usuarios/usuarios.json` (array de objetos Drupal).
- [x] Implementar el mapeo puro y validado de usuarios legacy, sin contraseñas ni asociaciones de recursos.
- [x] Implementar persistencia idempotente por UID namespaced y omisión segura ante colisión de correo.
- [x] Registrar `import:legacy-users` con `--source-file`, `--dry-run`, `--limit` e informe.
- [x] Añadir pruebas unitarias del mapeo, persistencia, ejecución de lote y registro del CLI.
- [x] Ejecutar pruebas automatizadas y comprobar la paridad archivo–test.
- [x] Ejecutar `--dry-run --limit 4` sobre el JSON exportado facilitado, en PGlite e informe aislados en `/tmp`.
- [ ] Ejecutar un piloto autorizado sobre un extracto representativo y definir el procedimiento de activación/restablecimiento de cuentas.

### Actualización de política de rol (2026-08-06)
- [x] Asignar el rol `editor` a todos los usuarios importados e ignorar los privilegios Drupal de origen.

### Corrección de política de rol (2026-08-06)
- [x] Restaurar el mapeo controlado `administrator` → `admin`; todos los demás usuarios quedan como `editor`.

### Cierre de PGlite en CLI (2026-08-06)
- [x] Cerrar PGlite explícitamente tras escribir el informe para evitar abortos del runtime al terminar.

### Correcciones de revisión del PR #309 (2026-08-07)
- [x] Hacer que `--dry-run` consulte los conflictos existentes y detecte ID/correo duplicados dentro del propio lote.
- [x] Normalizar emails en los flujos de creación y garantizar su unicidad sin distinción de mayúsculas mediante `lower(email)`.
- [x] Distinguir inserciones propias de conflictos concurrentes con `RETURNING`.

### Segunda revisión del PR #309 (2026-08-12)
- [x] Registrar la migración `0006_user_email_case_insensitive` en el journal de Drizzle y bloquear el despliegue si existen correos que solo difieren en mayúsculas/minúsculas.
- [x] Cerrar PGlite en `finally` también ante fallo de lectura, conexión o escritura del informe.
- [x] Separar `wouldImport` de `imported` y mostrar `importables` en `--dry-run`.

### Seguimiento de CI del PR #309 (2026-08-12)
- [x] Formatear con Biome el snapshot de Drizzle `0004_snapshot.json` para que respete la indentación configurada y no bloquee `make lint`.

## Propuesta de perfil de usuarios legacy — 2026-08-06 (issue #312)

- [x] Inventariar los grupos de campos presentes en `exportados-usuarios/usuarios.json` sin incorporar datos personales de ejemplo en la documentación.
- [x] Proponer ADR-0037 con la clasificación de campos, modelo lógico, reglas de migración y exclusiones de privacidad.
- [ ] Obtener la aceptación de ADR-0037 por Producto, Arquitectura, Metadatos y Seguridad/Privacidad.
- [ ] Crear la feature de implementación (migración Drizzle, validadores, controles de visibilidad, CLI idempotente e informe sin PII) solo tras la aceptación.

### Adenda de revisión ADR-0037 — 2026-08-12

- [x] Precisar que `display_name`, `bio` e `image` del legado pertenecen a `user_profile` y permanecen privados por defecto; `user` no alimenta representaciones públicas de autor.
- [x] Definir procedencia por campo y rollback por `migration_batch_id` que no sobrescribe ediciones posteriores.
- [x] Fijar política de reimportación: `null` se omite y los cambios de origen o usuarios existentes no se sobrescriben.
- [x] Corregir en GitHub la descripción del PR #315 y el comentario de la issue #312 para que mencionen ADR-0037.

## Estado de publicación del origen — 2026-10-22 (issue #447)

- [x] Leer `published` del JSON: 1 publica; 0, ausente o desconocido entra como borrador, con aviso si no es 0 ni 1.
- [x] Guardar en el informe el estado asignado y el valor recibido (`editorialStatus`, `sourcePublished`, `totals.importedAsDraft`).
- [x] Corrección única `--fix-published` con `--dry-run`, que no toca recursos con decisión editorial posterior.
- [x] Tests de mapeo, repositorio e integración; ADR-0029 y README actualizados.
- [ ] Ejecutar `--fix-published --dry-run` sobre el directorio de exportación real, revisar el informe y lanzar la corrección.
- [ ] Valorar si la previsualización por hash debe comprobar el estado del recurso.

## Idioma sin valor por defecto — 2026-10-26 (issue #473)

- [x] `normalizeLanguage()` devuelve `null` en vez de `"es"` y normaliza `va` a `ca`.
- [x] El idioma sale solo de `generalLanguageStr`; `educationalLanguageStr` ya no lo sustituye.
- [x] `resources.language` admite `null` (migración 0016 y `setup.ts`); el editor no preselecciona «Español» si falta.
- [x] Corrección única `--fix-language` con `--dry-run`, que solo toca recursos que siguen en `"es"`.
- [x] Tests de normalización, mapeo, migración, ficha e integración; ADR-0029 y README actualizados.
- [ ] Ejecutar `--fix-language --dry-run` sobre el directorio de exportación real, revisar el informe y lanzar la corrección.
