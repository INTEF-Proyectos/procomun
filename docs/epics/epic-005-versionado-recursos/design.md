# Design — Épica 005: versionado de recursos

## Fecha
2026-06-23

## Referencias
- Requisitos: [requirements.md](./requirements.md)
- Estudio de alternativas: [ADR-0028](../../negocio/decisiones/0028-versionado-recursos-educativos.md)
- Decisión concreta: [ADR-0032](../../negocio/decisiones/0032-versionado-recursos.md)
- Esquema actual: `packages/db/src/schema/resources.ts` (`resources`, `media_items`, `resource_subjects`, `resource_levels`), `packages/db/src/schema/elpx.ts`.

## Principio rector
Mantener **estable** la entidad pública `resources` y añadir un historial de snapshots inmutables. Cada fila de `resource_versions` es la fuente canónica de esa versión; `resources` y los `media_items` vigentes son una proyección denormalizada de `current_version_id` para conservar los contratos y el rendimiento actuales.

Los campos versionados no pueden actualizarse por caminos independientes: crear o restaurar una versión debe escribir snapshot, referencias de blobs, proyección vigente y puntero dentro de una única transacción PostgreSQL.

## Modelo de datos (propuesta)

### Tabla `resource_versions`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | text PK | id de versión |
| `resource_id` | text FK → `resources.id` (cascade) | recurso al que pertenece |
| `version_number` | integer | secuencial por recurso (1,2,3…) |
| `metadata_snapshot` | jsonb | copia de metadatos descriptivos, subjects y levels |
| `media_manifest` | jsonb | snapshot portable de `{ contentHash, filename, mimeType, fileSize, type, isPrimary }` |
| `change_notes` | text | changelog de la versión |
| `created_by` | text FK → `user.id` | autor del cambio |
| `created_at` | timestamp | fecha de la versión |

- `UNIQUE(resource_id, version_number)`.
- Las filas son append-only e inmutables.
- La asignación de `version_number` se realiza después de bloquear la fila de `resources` dentro de la transacción; la restricción única es una defensa adicional, no el mecanismo principal de coordinación.

### Puntero y proyección vigente
- Añadir `resources.current_version_id` (FK → `resource_versions.id`, nullable solo durante migración).
- `resources` conserva los metadatos vigentes y `media_items` las relaciones vigentes para que ficha pública, FTS y feeds no tengan que reconstruir JSON en cada consulta.
- Snapshot, proyección y `current_version_id` se actualizan juntos. Un test de invariantes debe comparar la proyección con el snapshot activo.

### Blobs direccionados por contenido

#### `content_blobs`
| Columna | Tipo | Notas |
|---------|------|-------|
| `hash` | text PK | SHA-256 hexadecimal |
| `size_bytes` | bigint | tamaño validado |
| `mime_type` | text | tipo detectado/validado |
| `storage_path` | text | ruta inmutable derivada del hash |
| `state` | enum/text | `ready` o `deleting` |
| `created_at` | timestamp | alta del blob |

#### `resource_version_blobs`
| Columna | Tipo | Notas |
|---------|------|-------|
| `version_id` | text FK → `resource_versions.id` | versión propietaria de la referencia |
| `blob_hash` | text FK → `content_blobs.hash` | blob reutilizado |
| `filename` | text | nombre lógico |
| `mime_type` | text | tipo en el manifiesto |
| `role` | text | primary, attachment, elpx, etc. |
| `position` | integer | orden estable |

- PK/UNIQUE adecuada sobre versión + blob + rol/posición.
- `media_manifest` sigue siendo parte del snapshot exportable, pero el GC consulta la tabla relacional; no analiza JSON para decidir si un blob está vivo.

## Flujos

### Publicar un blob
1. Escribir a una ruta temporal privada mientras se calcula SHA-256 y tamaño real.
2. Validar límites y contenido.
3. Publicar mediante `rename` atómico a la ruta inmutable derivada del hash. Si ya existe, verificar tamaño/hash y reutilizarlo.
4. Crear la referencia dentro de la transacción de versión.

Se publica físicamente antes del commit: un fallo puede dejar un blob huérfano, pero nunca una versión comprometida que apunte a un archivo parcial. Los huérfanos solo se limpian tras un periodo de gracia.

### Crear nueva versión (RF-001..RF-003)
1. Validar `canManageResource` y preparar metadatos/blobs fuera de la sección crítica.
2. Abrir transacción.
3. Bloquear la fila `resources` con `SELECT … FOR UPDATE`.
4. Leer `MAX(version_number)` para ese recurso y asignar el siguiente.
5. Insertar `resource_versions` y `resource_version_blobs`.
6. Actualizar la proyección `resources`, relaciones vigentes (`media_items`, subjects, levels) y `current_version_id`.
7. Registrar actividad transaccionalmente o mediante outbox si el registro vive fuera de la misma base.
8. Commit.

Si la restricción única detecta un conflicto inesperado, reintentar de forma acotada; nunca devolver un número duplicado ni calcularlo fuera del bloqueo.

### Historial y descarga (RF-004..RF-006)
- `GET /api/admin/resources/:id/versions` → lista número, fecha, autor, notas y vigente.
- `GET /api/admin/resources/:id/versions/:versionId/download` → empaqueta los blobs referenciados por esa versión.
- La ficha de edición muestra el historial con la vigente destacada.

### Restaurar (rollback no destructivo) (RF-007)
- `POST /api/admin/resources/:id/versions/:versionId/restore` (curador/admin).
- Usa el mismo bloqueo y operación transaccional que crear versión.
- Copia snapshot y referencias en una **nueva** versión, actualiza la proyección y registra `resource_version_restored`.
- Nunca muta ni elimina la versión restaurada.

### Búsqueda, feeds e interoperabilidad (RF-008)
- FTS, API pública, OAI-PMH, Atom y RSS operan sobre la proyección vigente en `resources`.
- Las versiones anteriores solo se exponen mediante endpoints explícitos y nunca aparecen como resultados independientes.

### Retención y GC (RF-009)
1. La poda selecciona versiones fuera de política, excluyendo siempre `current_version_id`.
2. Elimina las versiones y sus referencias en una transacción.
3. Un job separado obtiene blobs `ready` sin referencias y con antigüedad superior al periodo de gracia.
4. Para cada candidato, abre transacción, bloquea la fila, vuelve a comprobar `NOT EXISTS` y cambia el estado a `deleting`.
5. Tras el commit intenta borrar el archivo. Si funciona, elimina la fila; si falla, conserva `deleting` para reintento y alerta.
6. La creación de referencias rechaza blobs `deleting` o los devuelve a `ready` bajo el mismo bloqueo, según la política implementada.

No se usa un `ref_count` leído y actualizado fuera de transacción como fuente de verdad.

## Permisos (ADR-0008)
- Crear versión: `canManageResource`.
- Restaurar: curador/admin.
- Descargar versión previa: igual que ver el recurso en backoffice.

## Impacto por capa
- **DB**: `resource_versions`, `content_blobs`, `resource_version_blobs`, `current_version_id`, migración e invariantes.
- **Repositorio**: operación transaccional única para crear/restaurar y consultas de historial.
- **API**: endpoints de versiones y auditoría.
- **Frontend**: historial, notas, descarga y restauración.
- **Almacenamiento**: publicación temporal→hash, reconciliación de huérfanos y GC con estados.
- **Búsqueda/Interop**: solo la proyección vigente.

## Plan de validación (regla 14/16)
- Dos creaciones simultáneas sobre el mismo recurso producen versiones consecutivas distintas.
- Un conflicto de unicidad se reintenta o falla sin dejar una proyección parcial.
- La proyección vigente coincide con `metadata_snapshot` y referencias de `current_version_id`.
- Un fallo después del `rename` y antes del commit deja un huérfano sin referencias que el reconciliador puede limpiar tras la gracia.
- El GC no elimina un blob al que se añade una referencia concurrentemente.
- Un fallo al borrar el archivo deja estado reintentable y observable.
- Restaurar crea una nueva versión y no modifica historial.
- Versiones previas no aparecen en búsqueda ni feeds.

## Decisiones derivadas pendientes
- Formato exacto de descarga.
- Parámetros por defecto de retención y periodo de gracia.
- Integración fina con `.elpx`: paquete generado, fuentes o ambos.
- Estrategia de outbox si la auditoría no puede escribirse en la misma transacción.

## Estado
Diseño propuesto (F1–F3). La implementación queda condicionada a aceptar ADR-0032 y a convertir estas garantías en tests de integración.

---

## Adenda 2026-08-11 — Diseño MVP implementado (ADR-0038)

La implementación inicial (PR del issue #31) adopta el recorte de alcance
decidido en [ADR-0038](../../negocio/decisiones/0038-versionado-recursos-mvp.md):
el modelo de esta página se conserva como referencia para la fase de
optimización de almacenamiento, pero la F1+F2 entregadas usan el modelo mínimo:

### Modelo entregado
- **`resource_versions`** (única tabla nueva): `id`, `resource_id`,
  `version_number`, `elpx_project_id` (FK `ON DELETE RESTRICT`),
  `file_sha256`, `metadata_snapshot` JSONB, `change_notes`, `created_by`,
  `created_at`, con `UNIQUE(resource_id, version_number)`.
- **`resources.current_version_id`**: puntero a la versión vigente
  (FK declarada en SQL; columna simple en Drizzle para evitar import circular).
- **`elpx_projects` sin `UNIQUE(resource_id)`**: cada `.elpx` subido crea una
  fila; la copia de trabajo del autor es la más reciente y las versiones
  publicadas referencian las suyas. `elpx_projects.version` sigue siendo la
  versión del formato ELPX (3), no la editorial.
- **Sin** `content_blobs` ni `resource_version_blobs`: `file_sha256` reutiliza
  `upload_sessions.finalChecksum`; no hay dedupe ni GC (retención: se conserva
  todo; el borrado de proyectos/sesiones referenciadas está bloqueado por FK y
  por las guardas de `apps/api/src/services/elpx-retire.ts`).

### Flujos entregados
- Publicar (autor, `POST /api/admin/resources/:id/versions`): transacción con
  `SELECT … FOR UPDATE`, `MAX(version_number)+1`, snapshot de metadatos
  vigentes (incl. materias/niveles) y avance del puntero. 409 si la copia de
  trabajo ya está en el historial (una versión = una entrega publicada).
- Historial (`GET /api/admin/resources/:id/versions`): número, fecha, autor,
  notas, vigente y URL de descarga (`/api/admin/uploads/:id/content`).
- Restaurar (curador/admin, `POST …/versions/:versionId/restore`): crea una
  versión nueva reutilizando `elpx_project_id` y snapshot, aplica el snapshot a
  la proyección (`resources` + materias + niveles + tags), nota automática
  «Restaurada desde la versión N» y re-indexado FTS.
- Resolución pública por versión vigente (`getCurrentElpxProjectByResourceId`)
  con fallback a la copia de trabajo para recursos sin versiones; el editor
  sigue usando la copia de trabajo.
- La descarga pública de una sesión cuyo media item fue reemplazado sigue
  disponible mientras la sesión pertenezca al historial.
- Parser ELPX ampliado con `odeId`, `odeVersionId` y `exe_version`
  (informativos; el número de versión de Procomún es propio).
- UI: panel «Historial de versiones» en la página de edición (publicar con
  notas, listado con vigente, descarga, restaurar para curador/admin).

### Trazabilidad
- RF-001..RF-007 y RF-010 cubiertos; RF-008 se mantiene por construcción (solo
  la proyección se indexa/expone); RF-009 queda en política "conservar todo"
  documentada en ADR-0038 (GC diferido).
- Tests: `packages/db/src/repository/resource-versions.integration.test.ts`,
  `apps/api/src/routes/admin/versions.unit.test.ts`,
  `apps/api/src/routes/admin/elpx-versioning.unit.test.ts`,
  `apps/api/src/services/elpx-retire.unit.test.ts`,
  `packages/db/src/elpx-metadata.unit.test.ts`.
