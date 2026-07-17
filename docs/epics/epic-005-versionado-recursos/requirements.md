# Requirements — Épica 005: versionado de recursos

## Fecha
2026-06-23

## Fuente
- Requisito: <https://github.com/INTEF-Proyectos/procomun/issues/31>
- Decisión arquitectónica asociada: [ADR-0032](../../negocio/decisiones/0032-versionado-recursos.md).

## Problema público/educativo
Los recursos educativos evolucionan: se corrigen erratas, se actualizan contenidos, se adaptan a nuevos currículos. Hoy editar un recurso **sobrescribe** el estado anterior sin historial: no hay forma de saber qué cambió, recuperar una versión previa ni publicar una actualización conservando la anterior. Esto resta confianza editorial y trazabilidad a una plataforma de OER.

## Usuario principal
- **Autor/editor** que actualiza un recurso y necesita conservar el trabajo previo y anotar qué cambió.
- **Curador/admin** que audita la evolución de un recurso y puede revertir un cambio dañino (rollback).
- **Persona usuaria** que consume siempre la versión vigente por la misma URL estable.

## Objetivo de la épica
Dar a los recursos un **historial de versiones navegable, inmutable y auditable**, manteniendo URL/identificador público estables, con creación de nuevas versiones (archivo + metadatos), notas de cambio, descarga de versiones previas y restauración (rollback) no destructiva.

## Requisitos funcionales
- RF-001: el creador/editor de un recurso puede **publicar una nueva versión** (nuevos archivos y/o metadatos) sin perder la anterior.
- RF-002: cada versión queda asociada al **mismo recurso** (misma URL/slug/identificador público estable).
- RF-003: al crear una versión se pueden añadir **notas de cambio (changelog)**.
- RF-004: existe un **historial navegable** con todas las versiones: número, fecha, autor del cambio y notas.
- RF-005: se distingue con claridad la **versión vigente** de las anteriores.
- RF-006: se puede **descargar cualquier versión anterior** (sus archivos asociados).
- RF-007: se puede **restaurar una versión previa** como vigente (rollback) de forma **no destructiva** (crea una nueva versión vigente a partir del snapshot elegido; no borra el historial).
- RF-008: las **versiones anteriores no aparecen** como resultados de búsqueda ni en feeds (sin duplicados); solo la vigente se indexa y expone.
- RF-009: existe una **política de retención** configurable (nº de versiones y/o antigüedad) que documenta qué se conserva.
- RF-010: la creación/restauración de versiones queda registrada en la **actividad/auditoría** (quién, cuándo, qué).

## Requisitos no funcionales
- Trazabilidad: cada versión es **inmutable** una vez creada; el cambio es atribuible y fechado.
- Seguridad/permisos: crear versión = quien puede gestionar el recurso (`canManageResource`); restaurar = curador/admin. Reutiliza el RBAC existente (ADR-0008).
- Almacenamiento: el versionado multiplica el espacio; debe **reutilizar binarios no modificados** (direccionamiento por contenido) y permitir políticas de retención por coste.
- Interoperabilidad: OAI-PMH/feeds/API exponen la versión vigente; el historial es una extensión opcional, no rompe los contratos actuales.
- Rendimiento/búsqueda: FTS solo indexa la versión vigente; las anteriores no degradan la relevancia.
- Mantenibilidad: se apoya en el modelo actual (`resources`, `media_items`, `elpx_projects`) sin reescribirlo.

## Preguntas obligatorias (AGENTS.md) — respuestas de partida
1. **¿Qué problema educativo resuelve?** Confianza y trazabilidad de la evolución de los OER; recuperación ante errores.
2. **¿Qué usuario se beneficia?** Autores/editores (no pierden trabajo), curadores (auditan y revierten), consumidores (URL estable).
3. **¿Datos mínimos por versión?** número, autor, fecha, notas, snapshot de metadatos y manifiesto de archivos.
4. **¿Qué tecnología?** Misma capa (Postgres + Drizzle + storage local de uploads, ADR-0011); sin nuevas piezas de mercado obligatorias.
5. **¿Qué requiere desarrollo propio?** Tabla de versiones, snapshotting, manifiesto de media con reutilización por hash, endpoints y UI de historial.
6. **¿Impacto en búsqueda/metadatos/moderación?** Solo la vigente se indexa; el flujo editorial (estados) se mantiene por versión vigente.
7. **¿Cómo se valida la mejora?** Auditoría de cambios, rollback funcional y ausencia de duplicados en búsqueda/feeds.
8. **¿Riesgo de lock-in?** Bajo: modelo propio sobre Postgres/almacenamiento ya adoptado.

## Alcance por fases (propuesta)
- **F1 — Modelo + historial (mínimo viable):** tabla `resource_versions`, puntero a versión vigente, creación de versión (snapshot de metadatos + manifiesto de media), listado/historial y notas. RF-001..RF-005, RF-010.
- **F2 — Descarga y rollback:** descarga de versiones previas y restauración no destructiva. RF-006, RF-007.
- **F3 — Retención, búsqueda e interoperabilidad:** exclusión de anteriores en FTS/feeds, política de retención y optimización de almacenamiento por contenido. RF-008, RF-009.

## Fuera de alcance (esta épica)
- Object storage S3-compatible (sigue el storage local de ADR-0011).
- Diff visual campo a campo entre versiones (más allá de las notas de cambio).
- Versionado de colecciones/itinerarios (solo recursos).
- Ramas/merge de versiones (modelo lineal por recurso).

## Dependencias y relaciones
- Sistema de subidas resumibles (Épica 002 / ADR-0011) y `media_items`.
- RBAC (ADR-0008) y servicio canónico API/frontend (ADR-0021).
- FTS PostgreSQL (ADR-0026 de extracción de texto) para la exclusión de versiones anteriores.
