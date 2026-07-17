# ADR-0019 Formato YAML para tracking y dashboard de desarrollo

* Estado: Aceptado
* Fecha: 2026-04-10
* Agentes Implicados: [@.agents/skills/documentacion-y-roadmap, @.agents/skills/devops-sre]

## Contexto y Problema

El proyecto utiliza `STATUS.md` como tablero de estado global y archivos `.md` individuales para las ADRs. Cuando múltiples agentes o desarrolladores trabajan en paralelo y editan las mismas tablas Markdown, se producen conflictos de merge frecuentes porque:

- Git trata las filas de tablas Markdown como texto plano sin fronteras semánticas.
- La ventana de contexto de 3 líneas de `git merge` mezcla filas adyacentes.
- La alineación de columnas con pipes (`|`) es frágil ante ediciones concurrentes.
- No hay validación de esquema: errores de formato pasan desapercibidos.

Este problema fue analizado en detalle en el DR-0013 del proyecto idevices-spec, donde se midió que YAML con claves map reduce los conflictos de merge en >95% respecto a tablas Markdown.

## Opciones Consideradas

* **A) Mantener Markdown**: tablas en STATUS.md y ADRs como están. Simple pero propenso a conflictos.
* **B) YAML con listas (append-only)**: cada entrada es un item de lista. Reduce conflictos parcialmente pero dos appends al final del archivo siguen colisionando.
* **C) YAML con claves map**: cada entrada tiene una clave única (ej: `ADR-0017:`, `T-2026-04-10-001:`). Git puede mergear cambios a claves distintas sin conflicto.
* **D) JSON**: similar a YAML pero más ruidoso en diffs (llaves, comas, comillas).

## Decisión

Se elige la **opción C**: YAML con claves map para todos los documentos de tracking.

**Archivos migrados:**
- `STATUS.md` → `status.yaml` (tareas activas y completadas con claves únicas)
- Índice de ADRs → `docs/negocio/decisiones/decision-log.yaml` (mapa `ADR-NNNN:`)
- Las ADRs individuales siguen como `.md` (son documentos narrativos, no datos estructurados)

**Validación con JSON Schema:**
- `schemas/status.schema.yaml` — valida estructura de tareas
- `schemas/decision-log.schema.yaml` — valida índice de ADRs

**Dashboard de desarrollo:**
- `apps/frontend/public/dev/index.html` — HTML estático standalone que lee los YAML y muestra un panel interactivo con estado de tareas, ADRs y progreso. Accesible en `/dev/` sin depender de React ni del build.

## Consecuencias

### Positivas
* Reducción >95% de conflictos de merge en trabajo paralelo sobre archivos de tracking
* Validación de esquema: errores de formato detectados antes del commit
* Dashboard interactivo: visibilidad del estado del proyecto sin levantar entorno de desarrollo
* Datos consultables programáticamente (CI, scripts, herramientas)
* Diffs más claros en PRs (cambios aislados por clave)

### Negativas / Riesgos
* YAML es más verboso que tablas Markdown para lectura rápida en GitHub
* Requiere familiaridad con sintaxis YAML (mitigado por schemas y validación)
* El dashboard HTML estático no tiene autenticación (aceptable para datos de desarrollo no sensibles)

## Notas de Implementación

El formato de claves para `status.yaml` usa el patrón `T-YYYY-MM-DD-NNN` para tareas, garantizando unicidad temporal. Las claves de `decision-log.yaml` usan `ADR-NNNN` alineado con la numeración existente.

El dashboard se inspira en el implementado en el proyecto idevices-spec (DR-0013), adaptado al stack y estructura de Procomún.

### Enmienda 2026-07-17 — claves con hora y aleatorio

El contador diario `NNN` colisiona cuando dos PRs abiertas el mismo día eligen el siguiente número sin ver la otra rama. Git puede auto-mergear el YAML; el parser se queda con la última clave y el historial se pierde en silencio (mitigado en parte por `scripts/check-tracking.ts`, que falla si hay duplicados en texto crudo).

**Formato nuevo para entradas nuevas:** `T-YYYY-MM-DD-HHMMSSrr`

- `YYYY-MM-DD` y `HHMMSS` en **UTC**
- `rr`: dos dígitos aleatorios (00–99)
- Generador: `bun run new-status-key` (`scripts/new-status-key.ts`)
- Las claves históricas `T-YYYY-MM-DD-NNN` **no se reescriben**; el validador acepta ambos sufijos numéricos

Consecuencia: la probabilidad de colisión entre ramas paralelas deja de depender de coordinar el contador del día.
