# ADR-0037 Versionado mínimo de recursos (MVP): `resource_versions` + proyección vigente reutilizando `elpx_projects`

* Estado: Aceptado
* Fecha: 2026-08-11
* Agentes Implicados: [@.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/metadatos-y-curacion, @.agents/skills/qa-validacion]

## Contexto y Problema

El requisito #31 pide historial de versiones, notas de cambio, descarga de versiones previas y rollback no destructivo con URL/slug estables. ADR-0028 estudió alternativas y ADR-0032 concretó un diseño con snapshots inmutables **más** almacenamiento direccionado por contenido: `content_blobs`, `resource_version_blobs`, deduplicación global, estados de blobs, periodos de gracia y GC coordinado entre PostgreSQL y filesystem.

Para un MVP ese diseño introduce demasiadas piezas. Además, la plataforma ya dispone de bloques reutilizables que ADR-0032 no aprovechaba del todo:

* El `.elpx` es un ZIP autocontenido (proyecto editable en `content.xml`, HTML previsualizable, recursos y metadatos), con `odeId` estable y `exe_version` documentados por eXeLearning.
* `elpx_projects` ya representa "un `.elpx` subido y extraído" (fila + extracción en disco).
* `upload_sessions.finalChecksum` ya guarda el SHA-256 real calculado al finalizar la subida.

No se usa `odeVersionId` como número de versión de Procomún: la documentación de eXeLearning se contradice sobre su estabilidad (el generador conserva `meta.odeVersionId` si existe). La identificación fiable es el número secuencial propio más el SHA-256 del archivo; `odeId` queda como información para detectar que dos entregas proceden del mismo proyecto.

## Opciones Consideradas

* A) Implementar ADR-0032 completo (blobs por contenido + dedupe + GC) desde el inicio.
* B) **Modelo mínimo (elegida):** solo `resource_versions` + `resources.current_version_id`, tratando cada `.elpx` publicado como versión inmutable y reutilizando `elpx_projects` y `upload_sessions` tal cual.
* C) Versionar también cada guardado/edición de metadatos (versión por cada «Guardar»).

## Decisión

Se adopta el **modelo mínimo (B)**, que conserva los principios de ADR-0032 (snapshots inmutables, proyección vigente, rollback no destructivo, D1 en búsqueda) y aplaza su maquinaria de almacenamiento:

1. **Tabla única `resource_versions`**: `id`, `resource_id`, `version_number` (secuencial 1,2,3…), `elpx_project_id`, `file_sha256`, `metadata_snapshot` (JSONB con título, descripción, licencia, autoría, idioma, tipo, keywords, publisher, niveles y materias), `change_notes`, `created_by`, `created_at`, con `UNIQUE(resource_id, version_number)`.
2. **Puntero `resources.current_version_id`**: `resources` sigue siendo la identidad estable y la proyección de la versión vigente. Búsqueda, API pública, OAI-PMH y feeds no cambian de contrato ni muestran duplicados.
3. **Reutilización de `elpx_projects`**: se elimina el `UNIQUE` de `elpx_projects.resource_id`; cada `.elpx` subido crea una fila y la versión la referencia con FK `ON DELETE RESTRICT`. `elpx_projects.version` (=3) sigue siendo la versión del **formato** ELPX, no la editorial.
4. **SHA-256 existente**: `file_sha256` toma `upload_sessions.finalChecksum` (con `elpx_projects.hash` como reserva); no se crea otro sistema de hashes.
5. **Versión = entrega publicada**: solo se crea versión al pulsar «Publicar nueva versión» (con notas opcionales), en una transacción que bloquea el recurso (`SELECT … FOR UPDATE`), calcula `MAX(version_number)+1`, inserta el snapshot y actualiza el puntero. Los cambios de borrador/metadatos sin nueva entrega siguen registrándose solo en auditoría.
6. **Restauración no destructiva**: restaurar la versión N crea una versión nueva que referencia el mismo `elpx_project_id`, copia su `metadata_snapshot`, aplica el snapshot a la proyección (`resources`, materias, niveles, tags) y añade la nota automática «Restaurada desde la versión N». No se copia físicamente el `.elpx` ni se reescribe el historial.
7. **Retención**: se conservan todas las versiones. No hay GC hasta tener datos reales de volumen. Se **impide** borrar un `elpx_project` o los artefactos de una `upload_session` mientras estén referenciados por alguna versión (FK RESTRICT + guardas en los flujos de reemplazo). El purgado por motivos legales queda como operación explícita futura, separada de la retención normal.
8. **Resolución vigente vs. copia de trabajo**: la ficha pública y los listados resuelven el proyecto elpx vía `current_version_id` (con fallback al más reciente para recursos sin versiones); el editor del autor sigue operando sobre la copia de trabajo (último `.elpx` subido).
9. **Parser ELPX ampliado**: se extraen `odeId`, `odeVersionId` y `exe_version` de `content.xml` como metadatos informativos.

No se implementan inicialmente: `content_blobs`, `resource_version_blobs`, deduplicación global, object storage versionado, Git, event sourcing, GC automático ni versionado por pulsación de «Guardar».

## Consecuencias

### Positivas
* Cubre historial, descarga, notas, autoría, versión vigente, rollback, URL estable y ausencia de duplicados con **una tabla y un puntero**.
* Reutiliza `elpx_projects`, `upload_sessions` y el SHA-256 existentes; el diff sobre el modelo actual es pequeño y trazable.
* El rollback conserva una secuencia clara (restaurar v2 sobre v4 crea v5) sin destruir historial.
* La deduplicación por blobs y el GC de ADR-0032 quedan como optimización posterior sin condicionar el modelo público.

### Negativas / Riesgos
* Sin deduplicación: cada entrega ocupa espacio completo (aceptado hasta tener datos de volumen).
* La proyección puede divergir del snapshot vigente si se editan metadatos tras publicar (aceptado: el snapshot documenta "los metadatos en el momento de publicar"; los cambios siguen auditados).
* `metadata_snapshot` JSONB requiere normalización defensiva al restaurar (implementada en `parseVersionSnapshot`).
* Las guardas de retirada viven en la capa de rutas además del FK; nuevos flujos de borrado deben reutilizarlas (`elpx-retire.ts`).

## Notas de Implementación

* DB: `packages/db/src/schema/versions.ts`, columna `resources.current_version_id` (FK solo en SQL para evitar import circular), `setup.ts` y migración manual `0006_resource_versions.sql`.
* Repositorio: `packages/db/src/repository/resource-versions.ts` (`publishResourceVersion`, `listResourceVersions`, `restoreResourceVersion`, `countVersionsReferencingElpxProject`, `isUploadSessionReferencedByVersions`) y resolución vigente/copia de trabajo en `elpx-projects.ts`.
* API: `GET/POST /api/admin/resources/:id/versions` y `POST …/versions/:versionId/restore` (restaurar requiere curador/admin); descarga de versiones vía `/api/admin/uploads/:id/content`; actividad `resource_version_published` / `resource_version_restored`.
* Frontend: panel «Historial de versiones» en la página de edición (publicar con notas, listado con vigente, descarga y restauración).
* ADR-0032 pasa a considerarse diseño de referencia para la fase de optimización de almacenamiento; sus garantías de concurrencia (bloqueo + unique defensivo) sí se implementan aquí.
