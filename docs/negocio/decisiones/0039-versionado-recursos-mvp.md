# ADR-0039 Versionado mínimo de recursos (MVP): `resource_versions` + proyección vigente reutilizando `elpx_projects`

* Estado: Aceptado
* Fecha: 2026-08-11
* Agentes Implicados: [@.agents/skills/arquitectura-solucion, @.agents/skills/backend-api-servicios, @.agents/skills/metadatos-y-curacion, @.agents/skills/qa-validacion]

## Contexto y Problema

El requisito #31 pide historial, descarga de versiones previas y rollback no destructivo con URL/slug estables. ADR-0032 planteó un diseño más amplio con almacenamiento direccionado por contenido, deduplicación y GC, pero esas piezas no son necesarias para el MVP.

La primera implementación del MVP añadía una acción explícita «Publicar nueva versión» y notas de cambio. Ese flujo se confundía con la publicación editorial del recurso («Publicar» / «Publicar directamente») y añadía una interacción que no aportaba valor suficiente.

La plataforma ya dispone de las piezas necesarias para un modelo más simple:

* `elpx_projects` representa un `.elpx` subido o generado y extraído.
* `upload_sessions.finalChecksum` conserva el SHA-256 calculado al finalizar la subida.
* `resources` mantiene la identidad estable del recurso y puede apuntar a su versión vigente.

## Opciones Consideradas

* A) Implementar ADR-0032 completo desde el inicio.
* B) **Modelo mínimo automático (elegida):** `resource_versions` + `resources.current_version_id`; cada nuevo `.elpx` crea automáticamente una versión.
* C) Mantener una acción manual separada para crear versiones y notas de cambio.
* D) Versionar también cada edición de metadatos aunque no cambie el `.elpx`.

## Decisión

Se adopta el **modelo mínimo automático (B)**:

1. **Tabla `resource_versions`**: `id`, `resource_id`, `version_number` secuencial, `elpx_project_id`, `file_sha256`, `metadata_snapshot`, `created_by` y `created_at`, con `UNIQUE(resource_id, version_number)`. No existen notas de versión.
2. **Creación automática**: cada nuevo `.elpx` —subida directa, guardado desde el editor eXeLearning o generación desde adjuntos— crea inmediatamente una versión y la establece como vigente mediante `resources.current_version_id`.
3. **Publicación editorial separada**: crear una versión no publica el recurso. El estado editorial sigue gestionándose exclusivamente mediante las acciones «Publicar» / «Publicar directamente». Cuando el recurso está publicado, la ficha pública resuelve el `.elpx` desde `current_version_id`.
4. **Snapshots inmutables**: cada versión conserva el proyecto ELPX, SHA-256 y los metadatos vigentes en ese momento. Los cambios de metadatos sin un nuevo `.elpx` no crean otra versión.
5. **Reutilización de `elpx_projects`**: se elimina el `UNIQUE` de `elpx_projects.resource_id`; una versión referencia su proyecto mediante FK `ON DELETE RESTRICT`. `elpx_projects.version` sigue indicando la versión del formato ELPX, no la versión editorial.
6. **Restauración no destructiva**: restaurar una versión crea una versión nueva que reutiliza su `elpx_project_id` y snapshot, aplica esos metadatos a la proyección vigente y mueve `current_version_id`. El historial anterior no se modifica.
7. **Historial y descarga**: la interfaz mantiene el listado de versiones, identifica la vigente y permite descargar cualquier entrega. Curadores y administradores pueden restaurar versiones anteriores.
8. **Retención**: se conservan todas las versiones. Los proyectos ELPX y artefactos de subida referenciados por una versión no se eliminan durante los reemplazos normales.
9. **Concurrencia**: la creación de versión bloquea la fila del recurso (`SELECT … FOR UPDATE`), calcula el siguiente `version_number` y mantiene un `UNIQUE(resource_id, version_number)` como defensa adicional.

No se implementan inicialmente `content_blobs`, `resource_version_blobs`, deduplicación global, object storage versionado, Git, event sourcing ni GC automático.

## Consecuencias

### Positivas

* Se elimina la ambigüedad entre «crear versión» y «publicar recurso».
* El usuario no necesita recordar una acción adicional después de subir o guardar un `.elpx`.
* El modelo sigue cubriendo historial, descarga, autoría, versión vigente, rollback y URL estable con una tabla y un puntero.
* Se reutilizan `elpx_projects`, `upload_sessions` y el SHA-256 existentes.

### Negativas / Riesgos

* Cada nuevo `.elpx` genera una versión, por lo que el historial puede crecer más rápido que con creación manual.
* Sin deduplicación, cada entrega ocupa espacio completo.
* La proyección de metadatos puede cambiar después de crear una versión; el snapshot conserva los valores existentes cuando se creó esa versión.
* Nuevos flujos de borrado deben respetar las guardas de retención de `elpx-retire.ts`.

## Notas de Implementación

* DB: `packages/db/src/schema/versions.ts`, `resources.current_version_id`, `setup.ts` y migración `0007_resource_versions.sql`.
* Repositorio: `packages/db/src/repository/resource-versions.ts` mantiene creación, listado, restauración y guardas de retención.
* API: `GET /api/admin/resources/:id/versions` y `POST /api/admin/resources/:id/versions/:versionId/restore`. No existe un endpoint para crear versiones manualmente.
* ELPX: los endpoints de subida, guardado y generación crean automáticamente la nueva versión tras registrar `elpx_projects`.
* Frontend: «Historial de versiones» queda reducido a listado, versión vigente, descarga y restauración; se eliminan el botón «Publicar nueva versión» y las notas de cambio.
* ADR-0032 se mantiene como referencia para una futura optimización del almacenamiento.
