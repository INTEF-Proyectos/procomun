# ADR-0032 Modelo de versionado de recursos (snapshots inmutables + proyección vigente)

* Estado: Propuesto
* Fecha: 2026-06-23
* Agentes Implicados: [@.agents/skills/arquitectura-solucion, @.agents/skills/metadatos-y-curacion, @.agents/skills/backend-api-servicios, @.agents/skills/busqueda-y-descubrimiento, @.agents/skills/devops-sre]

## Relación con ADR-0028

ADR-0028 abre y compara las alternativas de versionado. Esta ADR no duplica aquel estudio: selecciona y concreta la opción de snapshots relacionales sobre PostgreSQL, incluyendo sus garantías de concurrencia, proyección pública y almacenamiento de binarios.

## Contexto y Problema

Los recursos educativos evolucionan y hoy editar un recurso **sobrescribe** el estado previo: no hay historial, rollback funcional ni trazabilidad completa de qué cambió (requisito #31). Se necesita un modelo que conserve el historial **sin** romper URL/slug estable (ADR-0021), flujo editorial, FTS, feeds ni el modelo actual `resources` + `media_items` + `.elpx`.

Las tensiones de diseño son: qué se versiona, cómo se representa el historial, cuál es la fuente canónica, cómo se asignan números bajo concurrencia, cómo se coordinan PostgreSQL y el almacenamiento local y cómo se evita borrar blobs todavía referenciados.

## Opciones Consideradas

### A) Qué se versiona
* A1 — Solo archivos.
* A2 — Solo metadatos.
* **A3 — Archivos + metadatos como snapshot único (elegida):** una versión captura el estado completo y permite un rollback coherente.

### B) Modelo del historial
* B1 — `resources` mutable + tabla de auditoría de cambios. Reconstruir una versión exige replay y el rollback es complejo.
* **B2 — Snapshots inmutables en `resource_versions` + proyección vigente en `resources` (elegida):** el historial es append-only y `resources` mantiene una proyección eficiente de la versión activa.
* B3 — Filas temporales con `valid_from`/`valid_to`. Potente, pero invasivo en todas las consultas actuales.

### C) Almacenamiento de binarios
* C1 — Copiar todos los archivos por versión. Simple, pero multiplica el espacio.
* **C2 — Direccionamiento por contenido con referencias normalizadas (elegida):** los blobs se identifican por SHA-256, se reutilizan y su alcanzabilidad se representa en una tabla relacional, no solo dentro de JSON.

### D) Búsqueda e interoperabilidad
* **D1 — Solo la proyección vigente se indexa y expone (elegida):** las versiones anteriores no son ítems independientes del catálogo.

## Decisión

Se adopta **A3 + B2 + C2 + D1**:

1. **Snapshots inmutables**: `resource_versions` guarda `version_number`, `metadata_snapshot`, `media_manifest`, `change_notes`, `created_by` y `created_at`.
2. **Fuente canónica**: cada versión histórica tiene como fuente canónica su snapshot. `resources` y los `media_items` vigentes son una **proyección denormalizada** de `resources.current_version_id` para mantener eficientes y compatibles las consultas públicas actuales. Los campos versionados no se modifican de forma independiente: snapshot, proyección y puntero se actualizan en la misma transacción.
3. **Concurrencia**: crear o restaurar una versión bloquea la fila de `resources` (`SELECT … FOR UPDATE`) dentro de una transacción, calcula allí `MAX(version_number) + 1`, inserta la versión y actualiza `current_version_id`. `UNIQUE(resource_id, version_number)` permanece como defensa adicional; un conflicto de unicidad se reintenta de forma acotada.
4. **Referencias de blobs**: `content_blobs` representa cada binario inmutable por SHA-256 y `resource_version_blobs(version_id, blob_hash, …)` mantiene las referencias normalizadas. `media_manifest` conserva el snapshot portable, pero no es la única fuente utilizada por el GC.
5. **Coordinación DB/almacenamiento**: el archivo se escribe primero en una ruta temporal, se valida su hash y se publica mediante `rename` atómico a la ruta inmutable del hash. Después, una transacción inserta/reutiliza `content_blobs`, crea la versión y sus referencias y actualiza la proyección. Un fallo antes del commit puede dejar un blob huérfano, nunca una versión que apunte a un archivo parcial; los huérfanos se eliminan solo tras un periodo de gracia.
6. **GC seguro**: el job selecciona candidatos sin referencias, vuelve a comprobar `NOT EXISTS` bajo bloqueo transaccional y los marca como `deleting` antes de tocar el sistema de archivos. Si reaparece una referencia, no se borra. Si falla el borrado físico, el estado permite reintento. Nunca se decide el borrado a partir de un recuento leído fuera de la transacción.
7. **Rollback no destructivo**: restaurar crea una nueva versión vigente copiando el snapshot elegido; nunca modifica ni elimina la versión anterior.
8. **Búsqueda y feeds**: FTS, API pública, OAI-PMH, Atom y RSS leen la proyección vigente; el historial queda fuera del catálogo salvo endpoints explícitos de versiones.
9. **Permisos**: crear versión requiere `canManageResource` (ADR-0008); restaurar requiere curador/admin.
10. **Retención**: política configurable por número y/o antigüedad; la versión vigente nunca se poda.

El alcance se entrega por fases: F1 modelo e historial, F2 descarga y rollback y F3 retención, búsqueda y almacenamiento.

## Consecuencias

### Positivas
* Historial inmutable, rollback seguro y URL pública estable.
* Asignación de versiones correcta bajo solicitudes concurrentes.
* Contrato claro: snapshot canónico y proyección vigente transaccional.
* Reutilización de blobs sin depender de búsquedas dentro de JSON para determinar alcanzabilidad.
* Un fallo entre filesystem y DB puede producir un huérfano recuperable, pero no una referencia a contenido incompleto.
* Sin duplicados en búsqueda y feeds.

### Negativas / Riesgos
* Mayor complejidad de modelo, migración y operación.
* PostgreSQL y filesystem no comparten una transacción distribuida; se acepta el patrón de publicación física previa más limpieza diferida de huérfanos.
* La proyección exige invariantes y tests que impidan divergencias respecto al snapshot vigente.
* El GC necesita estados, periodo de gracia, bloqueo y observabilidad.
* La integración con `.elpx` debe decidir si el blob versionado es el paquete generado, sus fuentes o ambos.

## Notas de Implementación

* DB: `resource_versions`, `content_blobs`, `resource_version_blobs` y `resources.current_version_id`, con FKs, índices y `UNIQUE(resource_id, version_number)`.
* Repositorio: una única operación transaccional `createResourceVersion`/`restoreResourceVersion` que bloquea el recurso, asigna número, crea snapshot/referencias y actualiza la proyección.
* Migración: crear v1 para recursos existentes y rellenar `current_version_id` antes de hacerlo obligatorio.
* API: endpoints de historial, descarga y restauración integrados con actividad/auditoría.
* Frontend: historial con versión vigente destacada, notas, descarga y restauración.
* Tests obligatorios: dos creaciones concurrentes producen números distintos y consecutivos; fallo entre publicación física y commit deja solo un huérfano limpiable; GC no elimina un blob referenciado concurrentemente; restauración crea versión nueva sin mutar historial.
* Operación: métricas de blobs huérfanos, blobs en `deleting`, reintentos y divergencias entre proyección y snapshot.
