# Design — Épica 002: subidas resumibles y adjuntos

## Decisión técnica

- Protocolo base: `tus`
- Cliente: `Uppy` en modo headless
- Storage inicial: disco local/volumen
- Persistencia de estado: tabla `upload_sessions`

## Flujo principal

1. El usuario abre la edición de un recurso existente.
2. El frontend crea uploads contra `/api/uploads` con metadata del recurso.
3. La API valida sesión, RBAC, límites y metadata del archivo.
4. `tus` escribe el binario en disco sin cargarlo entero en memoria.
5. Al completar, la API crea el `media_item` y marca la sesión como `completed`.
6. El editor refresca uploads recientes y archivos adjuntos del recurso.

## Entidades nuevas

- `upload_sessions`
  - estado operativo del upload
  - resourceId / ownerId
  - nombre, tamaño, checksum, ruta lógica y timestamps

## UX

- selector de archivos + drag & drop
- cola local con progreso
- uploads recientes persistidos por recurso
- listado de archivos adjuntos ya finalizados
- aviso al cerrar pestaña con uploads activos

## Riesgos

- el almacenamiento local necesita limpieza/rotación
- el checksum por chunk queda como refuerzo posterior sobre el flujo base
- el preview estático no soporta binarios reales

## Actualización 2026-04-12 — propuesta ADR-0020

### Enfoque de diseño a validar

- mantener el flujo actual de subida manual y generación posterior de `.elpx`
- introducir una fase de clasificación de adjuntos ya persistidos en `media_items`
- seleccionar plantilla de generación según:
  - familia MIME homogénea: `image/*`, `audio/*`, `video/*`
  - cardinalidad: `1` o `N`
- usar el generador genérico actual como fallback cuando no haya homogeneidad o el tipo no esté soportado

### Invariantes que deben mantenerse

- la subida nativa de `.elpx` no cambia
- el `.elpx` derivado sigue registrándose como `elpx_project`
- los archivos originales siguen existiendo como `media_items`
- cada archivo sigue disponiendo de URL directa reutilizable
