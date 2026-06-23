# ADR-0029 Modelo de versionado de recursos (snapshots inmutables + puntero a versión vigente)

* Estado: Propuesto
* Fecha: 2026-06-23
* Agentes Implicados: [@.agents/skills/arquitectura-solucion, @.agents/skills/metadatos-y-curacion, @.agents/skills/backend-api-servicios, @.agents/skills/busqueda-y-descubrimiento, @.agents/skills/devops-sre]

## Contexto y Problema

Los recursos educativos evolucionan y hoy editar un recurso **sobrescribe** el estado previo: no hay historial, ni rollback, ni trazabilidad de qué cambió (requisito #31). Se necesita un modelo de versionado que conserve el historial **sin** romper lo que ya funciona: URL/slug estable (ADR-0021), estado editorial, indexación FTS y feeds, y el modelo `resources` + `media_items` + `.elpx`.

Las tensiones de diseño son: (a) **qué se versiona** (archivo, metadatos o ambos); (b) **cómo se modela el historial** (mutación con tabla de auditoría vs. snapshots inmutables); (c) **almacenamiento** (el versionado multiplica el espacio); (d) **búsqueda/interoperabilidad** (no duplicar recursos por sus versiones).

## Opciones Consideradas

### A) Qué se versiona
* A1 — Solo archivos.
* A2 — Solo metadatos.
* **A3 — Archivos + metadatos como snapshot único (elegida):** una versión captura el estado completo (metadatos + manifiesto de media). Es lo que da trazabilidad real y rollback coherente.

### B) Modelo del historial
* B1 — `resources` mutable + tabla de auditoría de cambios (event log). Reconstruir una versión exige replay; rollback complejo.
* **B2 — Snapshots inmutables en `resource_versions` + `resources.current_version_id` apuntando a la vigente (elegida):** `resources` sigue siendo la entidad pública estable (URL, estado, FTS); el historial es append-only e inmutable. Rollback = crear nueva versión desde un snapshot.
* B3 — Versionado a nivel de fila con `valid_from/valid_to` (temporal tables). Potente pero invasivo en todas las consultas actuales.

### C) Almacenamiento de binarios
* C1 — Copiar todos los archivos por versión. Simple pero multiplica el espacio.
* **C2 — Direccionamiento por contenido (hash) con reutilización (elegida):** los binarios sin cambios se referencian por hash y no se duplican; GC cuando ningún manifiesto vivo los referencia.

### D) Búsqueda e interoperabilidad
* **D1 — Solo la versión vigente se indexa/expone (elegida):** FTS y feeds operan sobre `resources`; las versiones anteriores nunca son ítems del catálogo → sin duplicados.

## Decisión

Se adopta **A3 + B2 + C2 + D1**:

1. **Snapshots inmutables**: tabla `resource_versions` (append-only) con `version_number` por recurso, `metadata_snapshot` (jsonb, alineado con ADR-0025), `media_manifest` (jsonb con hashes), `change_notes`, `created_by`, `created_at`.
2. **Versión vigente**: `resources` conserva los metadatos/medias vigentes y gana `current_version_id`. La entidad pública (URL/slug/estado/FTS) **no cambia**.
3. **Almacenamiento por contenido**: binarios identificados por hash; reutilización entre versiones; GC sujeto a retención.
4. **Rollback no destructivo**: restaurar crea una **nueva** versión vigente a partir del snapshot elegido; nunca borra historial.
5. **Búsqueda/feeds**: solo la vigente se indexa y expone; las anteriores quedan fuera del catálogo.
6. **Permisos**: crear versión = `canManageResource` (ADR-0008); restaurar = curador/admin.
7. **Retención**: política configurable (N últimas y/o M meses); la vigente nunca se poda.

El alcance se entrega por fases (F1 modelo+historial, F2 descarga+rollback, F3 retención+búsqueda/almacenamiento), descritas en `docs/epics/epic-004-versionado-recursos/`.

## Consecuencias

### Positivas
* Trazabilidad e inmutabilidad reales; rollback seguro; URL pública estable.
* Mínimo impacto en consultas actuales: `resources` sigue siendo la fuente vigente; el historial es aditivo.
* Control de coste de almacenamiento por reutilización de binitos por hash.
* Sin duplicados en búsqueda/feeds; contratos de interoperabilidad intactos.
* Reutiliza RBAC (ADR-0008), jsonb (ADR-0025) y storage local (ADR-0011).

### Negativas / Riesgos
* Mayor complejidad del modelo de datos y de los flujos de edición/publicación.
* Coste de almacenamiento crece pese a la reutilización; obliga a una política de retención y a GC correcto (riesgo de borrar binarios aún referenciados si el GC es incorrecto).
* La migración debe poblar `current_version_id` y, opcionalmente, crear la v1 de los recursos existentes.
* El snapshot en jsonb desacopla del esquema normalizado: hay que cuidar la coherencia al render/restaurar.
* Integración con el pipeline `.elpx` requiere decidir si se versiona el `.elpx` generado o los binarios fuente (decisión derivada).

## Notas de Implementación

* DB: tabla `resource_versions` + `resources.current_version_id` + migración; repos `createVersion`/`listVersions`/`getVersion`/`restoreVersion` con paridad de tests (regla 16).
* API: endpoints `GET …/versions`, `GET …/versions/:id/download`, `POST …/versions/:id/restore`, integrados con actividad/auditoría.
* Frontend: panel de historial en la edición del recurso (versión vigente destacada, notas, descarga, restaurar).
* Búsqueda/feeds: garantizar exclusión de versiones anteriores en FTS y OAI-PMH/Atom/RSS.
* Operación: comando de poda por retención + GC de binarios huérfanos; parámetros por entorno.
* Decisiones derivadas a fijar al implementar: algoritmo de hash, formato de empaquetado de descarga, snapshot jsonb vs. normalizado, defaults de retención e integración fina con `.elpx`.
