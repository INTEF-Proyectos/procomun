# ADR-0025 Usar jsonb para metadatos semiestructurados

* Estado: Aceptado
* Fecha: 2026-05-26
* Agentes Implicados: [@.agents/skills/backend-api-servicios, @.agents/skills/arquitectura-solucion]

## Contexto y Problema

Los campos `elpx_projects.elpx_metadata` y `activity_events.metadata` almacenan JSON serializado como `text`. Esto obliga a usar `JSON.stringify()` al escribir y `JSON.parse()` al leer, sin validación nativa por parte de PostgreSQL. Con PGlite 0.4.5 y Drizzle 0.45.2, el tipo `jsonb` está soportado de forma nativa, lo que permite aprovechar las capacidades JSON de PostgreSQL.

Relacionado con la issue #33 (Full Text Search con PostgreSQL): los metadatos ELPX (título, descripción, autor) podrían alimentar el `tsvector` de búsqueda directamente desde JSONB sin necesidad de parsear texto en la aplicación.

## Opciones Consideradas

* **Opción 1: Mantener `text` con JSON serializado.** Sin cambios. Obliga a serialización manual, sin validación ni capacidad de consulta SQL sobre el contenido JSON.
* **Opción 2: Normalizar metadatos en columnas/tablas separadas.** Mayor rigidez, migraciones frecuentes al añadir campos, no se adapta bien a metadatos semiestructurados y variables.
* **Opción 3: Usar `jsonb`.** Validación nativa, consultas SQL directas sobre propiedades JSON, compatibilidad con índices GIN futuros, eliminación de serialización manual.

## Decisión

Se adopta la **Opción 3: usar `jsonb`** para los campos `elpx_projects.elpx_metadata` y `activity_events.metadata`.

Justificación:
- Elimina código de serialización/deserialización propenso a errores.
- PostgreSQL valida el JSON al insertar.
- Habilita consultas directas tipo `WHERE elpx_metadata->>'title' ILIKE '%texto%'`.
- Prepara la integración con FTS (#33) sin parseo adicional.

**Decisión explícita sobre índices GIN:** no se añaden índices GIN en esta iteración. Se añadirán cuando exista una query real que los justifique y se pueda medir el beneficio.

## Consecuencias

### Positivas
* Eliminación de `JSON.stringify()` / `JSON.parse()` manuales.
* Validación de integridad del JSON por parte del motor de base de datos.
* Posibilidad futura de consultas y filtrado SQL sobre propiedades internas del JSON.
* Mejor integración con Full Text Search (#33).
* Sin impacto en el tamaño de almacenamiento (JSONB es más compacto que TEXT para JSON).

### Negativas / Riesgos
* La migración de datos existentes requiere conversión `USING column::jsonb`.
* Strings vacíos en la columna text causarían error al convertir; se usa `NULLIF(col, '')::jsonb` como protección.
* Mínimo riesgo de incompatibilidad con versiones antiguas de PGlite (mitigado: PGlite 0.4.5 soporta jsonb).

## Notas de Implementación

1. Cambiar `text()` por `jsonb()` en los schemas Drizzle.
2. Actualizar `setup.ts` (tablas PGlite) con `JSONB` en vez de `TEXT`.
3. Eliminar todas las llamadas `JSON.stringify()` al escribir y `JSON.parse()` al leer estos campos.
4. Crear migración SQL con `ALTER COLUMN ... SET DATA TYPE jsonb USING NULLIF(col, '')::jsonb`.
5. Los índices GIN se evaluarán en una futura iteración vinculada a la issue #33.
