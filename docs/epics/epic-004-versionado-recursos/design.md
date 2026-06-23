# Design — Épica 004: versionado de recursos

## Fecha
2026-06-23

## Referencias
- Requisitos: [requirements.md](./requirements.md)
- Decisión: [ADR-0029](../../negocio/decisiones/0029-versionado-recursos.md)
- Esquema actual: `packages/db/src/schema/resources.ts` (`resources`, `media_items`, `resource_subjects`, `resource_levels`), `packages/db/src/schema/elpx.ts`.

## Principio rector
Mantener **estable** la entidad pública `resources` (id, slug, URL, estado editorial, indexación FTS) y añadir un **historial de snapshots inmutables** colgando de ella. La fila `resources` representa siempre la **versión vigente**; el historial vive en una tabla nueva.

## Modelo de datos (propuesta)

### Tabla `resource_versions`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | text PK | id de versión |
| `resource_id` | text FK → `resources.id` (cascade) | recurso al que pertenece |
| `version_number` | integer | secuencial por recurso (1,2,3…) |
| `metadata_snapshot` | jsonb | copia de los metadatos descriptivos en el momento (título, descripción, idioma, licencia, tipo, keywords, autor, publisher, accesibilidad, subjects, levels) — ver ADR-0025 (jsonb para metadatos) |
| `media_manifest` | jsonb | lista de `{ contentHash, filename, mimeType, fileSize, type, isPrimary }` que referencia binarios en el almacén por contenido |
| `change_notes` | text | changelog de la versión |
| `created_by` | text FK → `user.id` | autor del cambio |
| `created_at` | timestamp | fecha de la versión |

- **UNIQUE(`resource_id`, `version_number`)**.
- Las filas de `resource_versions` son **inmutables** tras crearse (append-only).

### Puntero a la versión vigente
- Añadir `resources.current_version_id` (text, FK → `resource_versions.id`, nullable durante migración).
- La versión vigente es la fuente para render público, FTS y feeds. El historial no se indexa.

### Almacenamiento de binarios (reutilización por contenido)
- Cada binario se identifica por **hash de contenido** (p. ej. sha-256). El `media_manifest` referencia el hash.
- Subir una versión que reutiliza archivos sin cambios **no duplica** el binario (mismo hash → misma ruta en el almacén local de uploads, ADR-0011).
- Recolección de basura: un binario se puede borrar solo cuando ningún `media_manifest` vivo lo referencia y la política de retención lo permite.

## Flujos

### Crear nueva versión (RF-001..RF-003)
1. El usuario con permiso de gestión (`canManageResource`) edita metadatos y/o sube archivos nuevos y pulsa "Publicar nueva versión" con notas de cambio.
2. El backend:
   - calcula el `version_number` siguiente,
   - construye `metadata_snapshot` y `media_manifest` (hash de cada binario; reutiliza los existentes),
   - inserta la fila inmutable en `resource_versions`,
   - actualiza `resources` con los metadatos vigentes, los `media_items` vigentes y `current_version_id`,
   - registra actividad (`resource_version_created`).

### Historial y descarga (RF-004..RF-006)
- `GET /api/admin/resources/:id/versions` → lista (número, fecha, autor, notas, vigente sí/no).
- `GET /api/admin/resources/:id/versions/:versionId/download` → empaqueta los binarios del manifiesto de esa versión.
- La ficha de edición muestra el historial con la versión vigente destacada.

### Restaurar (rollback no destructivo) (RF-007)
- `POST /api/admin/resources/:id/versions/:versionId/restore` (curador/admin):
  - **no** borra nada; crea una **nueva versión vigente** copiando el snapshot/manifiesto de la versión elegida (nuevo `version_number`, nota "Restauración de v{n}"),
  - actualiza `resources` + `current_version_id`,
  - registra actividad (`resource_version_restored`).

### Búsqueda, feeds e interoperabilidad (RF-008)
- FTS y feeds (OAI-PMH/Atom/RSS) operan **solo** sobre `resources` (versión vigente). Las filas de `resource_versions` nunca se indexan ni se exponen como recursos independientes → sin duplicados.
- El historial puede exponerse como extensión opcional de la API, no como ítems del catálogo.

### Retención (RF-009)
- Política configurable por entorno: conservar las últimas N versiones y/o las de los últimos M meses.
- Job/comando de poda que elimina filas de versión fuera de política y ejecuta GC de binarios huérfanos. La versión vigente nunca se poda.

## Permisos (ADR-0008)
- Crear versión: `canManageResource` (autor/editor dueño, curador en cola, admin).
- Restaurar: curador/admin.
- Descargar versión previa: igual que ver el recurso en el backoffice.

## Impacto por capa
- **DB** (`packages/db`): nueva tabla + columna + repos (`createVersion`, `listVersions`, `getVersion`, `restoreVersion`) y migración. Paridad de tests (regla 16).
- **API** (`apps/api`): endpoints de versiones (sobre `crud`/rutas admin) + actividad.
- **Frontend** (`apps/frontend`): panel de historial en la edición del recurso, botón "Publicar nueva versión" con notas, acciones de descarga y restauración.
- **Almacenamiento**: indexación por hash y GC.
- **Búsqueda/Interop**: garantizar exclusión de versiones anteriores.

## Plan de validación (regla 14/16)
- Unit repos: creación incrementa `version_number`, snapshot/manifiesto correctos, reutilización por hash, restauración crea versión nueva sin borrar historial.
- Unit/integración API: permisos (author dueño crea; reader no; curador/admin restauran), listado, descarga y rollback.
- Búsqueda: una versión anterior no aparece en resultados ni feeds.
- Retención: la poda respeta N/M y nunca elimina la vigente.

## Decisiones abiertas (a fijar en ADR-0029 o derivadas)
- Algoritmo de hash y formato de empaquetado de descarga.
- Si el snapshot guarda metadatos como jsonb (propuesto) o filas normalizadas.
- Parámetros por defecto de retención.
- Integración fina con el pipeline `.elpx` (¿se versiona el `.elpx` generado o los binarios fuente?).

## Estado
Diseño propuesto (F1–F3). Implementación por features derivadas tras aprobar ADR-0029.
