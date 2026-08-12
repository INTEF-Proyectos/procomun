# Requirements — Épica 005: versionado de recursos

## Fecha
2026-06-23 (actualizado 2026-08-12)

## Fuente
- Requisito: issue #31.
- Decisión implementada: [ADR-0039](../../negocio/decisiones/0039-versionado-recursos-mvp.md).
- ADR-0032 se conserva como referencia para una optimización futura del almacenamiento.

## Objetivo
Mantener un historial inmutable de las entregas `.elpx` de cada recurso sin cambiar su URL pública. El versionado es automático: cada nuevo `.elpx` generado o subido crea una versión y pasa a ser la vigente.

## Requisitos funcionales
- RF-001: cada nuevo `.elpx` de un recurso crea automáticamente una versión sin perder las anteriores.
- RF-002: todas las versiones pertenecen al mismo recurso y mantienen su URL/slug/identificador público.
- RF-003: la versión recién creada pasa a ser la vigente; no existe una acción manual adicional para «publicarla».
- RF-004: existe un historial navegable con número, fecha y autor de cada versión.
- RF-005: se distingue claramente la versión vigente.
- RF-006: se puede descargar una versión anterior mientras sus artefactos formen parte del historial.
- RF-007: curadores y administradores pueden restaurar una versión previa de forma no destructiva; la restauración crea una nueva versión.
- RF-008: solo la versión vigente se expone en búsqueda, feeds y API pública ordinaria.
- RF-009: el MVP conserva todas las versiones; la política de GC queda diferida hasta disponer de datos reales de volumen.
- RF-010: creación automática y restauración quedan registradas en actividad/auditoría.

## Requisitos no funcionales
- Las versiones son append-only e inmutables.
- `version_number` es secuencial por recurso y se asigna bajo bloqueo transaccional.
- Un `.elpx` referenciado por el historial no puede eliminarse.
- `resources.current_version_id` selecciona la versión vigente sin duplicar la identidad pública del recurso.
- No se almacenan notas de versión/changelog.

## Fuera de alcance del MVP
- Notas de versión.
- Publicación manual de una versión tras guardar/subir el `.elpx`.
- Diff visual entre versiones.
- Retención configurable y GC.
- Ramas o merge de versiones.
- Versionado de colecciones/itinerarios.
