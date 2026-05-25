# Tasks — Épica 002: subidas resumibles y adjuntos

## Estado
En desarrollo

## Backend
- [x] Añadir `upload_sessions` al esquema compartido y setup de tablas.
- [x] Integrar rutas `/api/uploads` con protocolo resumable.
- [x] Persistir estado de upload y crear `media_items` al completar.
- [x] Exponer endpoints admin para config, uploads recientes, adjuntos y descarga autenticada.

## Frontend
- [x] Extender `ApiClient` con contratos de uploads.
- [x] Añadir panel de uploads en edición de recursos.
- [x] Soportar cola multiarchivo, progreso, cancelación y listado de adjuntos.
- [x] Redirigir la creación de recurso al editor para adjuntar archivos.

## Documentación
- [x] Registrar ADR de subidas resumibles.
- [x] Documentar variables de entorno y operación básica en README.
- [x] Actualizar `status.yaml` con el estado de la entrega.

## Validación
- [x] Tests unitarios de configuración de uploads.
- [x] Tests de integración del flujo `tus` básico (crear, completar, cancelar).
- [x] `env -u DATABASE_URL bun run check-coverage`

## Actualización 2026-04-12 — propuesta ADR-0020

### Descubrimiento y decisión
- [x] Formalizar issue #120 como decisión arquitectónica pendiente.
- [x] Redactar ADR-0020 y dejarla aceptada.
- [x] Alinear la épica 002 con la aceptación de ADR-0020.

### Implementación futura si ADR-0020 se acepta
- [ ] Clasificar adjuntos homogéneos por familia MIME renderizable.
- [ ] Introducir plantillas especializadas para imagen única y galería.
- [ ] Introducir plantillas especializadas para audio único y colección reproducible.
- [ ] Introducir plantillas especializadas para vídeo único y colección reproducible.
- [ ] Mantener fallback genérico para adjuntos mixtos o no soportados.
- [ ] Verificar que las URLs directas de `media_items` siguen funcionando como contrato estable.

## Actualización 2026-05-25 — issue #160 / DEF-009

### Corrección del flujo de alta con `.elpx`
- [x] Sustituir la precarga basada en `refs` de `NuevoPage` por estado React controlado para evitar la carrera de montaje tras `setShowForm(true)`.
- [x] Aplicar los metadatos analizados del `.elpx` sobre el estado del formulario antes del render visible.
- [x] Añadir test TypeScript para la función de aplicación de metadatos del `.elpx`.

## Actualización 2026-05-25 — issue #157 / DEF-006

### Corrección del flujo manual para `editor`
- [x] Alinear permisos de uploads resumables para que `editor` pueda adjuntar ficheros a recursos creados por el propio editor.
- [x] Añadir regresión TypeScript en el helper `canManageResourceUpload()`.
- [x] Añadir test de integración TUS para alta manual + subida PDF con rol `editor`.
