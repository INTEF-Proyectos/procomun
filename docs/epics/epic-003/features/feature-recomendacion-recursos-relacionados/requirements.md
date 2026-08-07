# Requirements — Sistema de recomendación de recursos relacionados

* Issue: #72
* ADR: ADR-0036
* Fecha: 2026-08-06

## Problema público

El profesorado llega a un recurso útil y no descubre otros afines. Sin sugerencias contextuales, el catálogo se comporta como un listado plano y se pierde reutilización.

## Usuario principal

Docente / lector que consulta la ficha pública de un recurso publicado.

## Alcance (esta entrega)

### In scope

1. Endpoint público de recursos relacionados.
2. Ranking multi-señal (metadatos, keywords, autor, colecciones, FTS).
3. Sección UI “Recursos relacionados” (4–8 cards) en la ficha.
4. Sección opcional “Más del mismo autor”.
5. Tests unitarios del score y del servicio (sin `expect(true)`).
6. ADR y trazabilidad documental.

### Out of scope

1. “Recomendados para ti” personalizado (fase 3).
2. Collaborative filtering item-item.
3. Motor ML / embeddings.
4. Cache distribuido o tablas materializadas.

## Criterios de aceptación

1. Dado un recurso publicado A con materias/niveles compartidos con B (publicado), B aparece en relacionados de A con score &gt; 0.
2. Un recurso draft o archivado nunca aparece como recomendación.
3. El propio recurso no se recomienda a sí mismo.
4. Sin solapamiento de señales, la lista puede estar vacía (no relleno aleatorio).
5. `limit` se clampea al rango [4, 8]; default 6.
6. La UI solo renderiza la sección si hay al menos un resultado.
7. `bun test` del módulo de recomendaciones en verde.

## Datos mínimos

Para ser útil, el recurso semilla idealmente tiene al menos uno de: subjects, levels, resourceType, keywords, author/createdBy, membresía en colección, o `search_vector` poblado.
