# Design — Épica 005: versionado de recursos

## Estado
Implementado como MVP según [ADR-0039](../../negocio/decisiones/0039-versionado-recursos-mvp.md).

## Modelo
El recurso mantiene una identidad pública estable en `resources`. El historial se representa con una única tabla nueva, `resource_versions`, y el puntero `resources.current_version_id`.

`resource_versions` contiene:
- `id`
- `resource_id`
- `version_number`
- `elpx_project_id`
- `file_sha256`
- `metadata_snapshot`
- `created_by`
- `created_at`

No existe `change_notes`. `elpx_projects.resource_id` deja de ser único porque cada entrega histórica conserva su propio proyecto ELPX.

## Creación automática
Los tres flujos que producen un nuevo `.elpx` crean la versión inmediatamente:
1. subida directa;
2. guardado desde el editor eXeLearning;
3. generación desde los adjuntos del recurso.

La operación de repositorio bloquea la fila de `resources`, asigna `MAX(version_number) + 1`, guarda el snapshot y actualiza `current_version_id` en la misma transacción. No existe `POST /api/admin/resources/:id/versions` para crear versiones manualmente.

## Historial
`GET /api/admin/resources/:id/versions` devuelve número, fecha, autor, estado vigente y URL de descarga. La interfaz solo ofrece historial, descarga y restauración.

## Restauración
`POST /api/admin/resources/:id/versions/:versionId/restore` requiere curador/admin. Restaurar crea una nueva versión que reutiliza el ELPX histórico y aplica su snapshot a la proyección vigente. Nunca muta ni elimina versiones anteriores.

## Retención
Se conserva todo el historial en el MVP. Las FK y las guardas de retirada impiden borrar proyectos o sesiones necesarios para versiones previas. La deduplicación avanzada y el GC de ADR-0032 quedan diferidos.

## Búsqueda y publicación editorial
El versionado del archivo es independiente del estado editorial del recurso. Si el recurso está publicado, la ficha pública resuelve el ELPX mediante `current_version_id`; búsqueda y feeds siguen trabajando sobre la proyección `resources`, evitando duplicados.

## Acceso público a artefactos — 2026-08-13 (issue #323)

Solo la versión vigente se expone en la API pública ordinaria (RF-008):

- `GET /api/v1/uploads/:id/content` permite descargar un `.elpx` sin `media_item` únicamente si esa sesión pertenece al `elpx_project` de `resources.current_version_id`. Una URL conocida de una versión histórica responde `404`.
- `GET /api/v1/elpx/:hash/` no sirve extracciones cuyo hash ya no es el de la versión vigente. Las extracciones históricas se conservan en disco para administración.
- El historial admin sigue descargando por `GET /api/admin/uploads/:id/content`.
- La previsualización histórica usa `GET /api/admin/resources/:resourceId/versions/:versionId/preview/*`, autenticada y con el mismo aislamiento `sandbox` (sin `allow-same-origin`) que el endpoint público. Los subrecursos se reescriben a esa ruta para no reabrir el hash público.

Restaurar una versión anterior crea una nueva versión vigente que reutiliza el ELPX histórico; a partir de ese momento su hash y su upload vuelven a ser públicos.

## Vista previa histórica con enlace firmado — 2026-11-03 (issue #482)

- La URL del historial sigue siendo `GET /api/admin/resources/:resourceId/versions/:versionId/preview/*`. Comprueba el acceso con la sesión y responde `302` al enlace firmado `/api/v1/elpx/preview/<hash>/<token>/` (ADR-0026, adendas 2026-10-27 y 2026-11-03).
- Los subrecursos y las subpáginas se reescriben con el prefijo firmado, no con la ruta de administración: el iframe de origen opaco no manda la cookie en esas peticiones.
- El hash histórico sigue sin servirse por `GET /api/v1/elpx/:hash/` (RF-008).
