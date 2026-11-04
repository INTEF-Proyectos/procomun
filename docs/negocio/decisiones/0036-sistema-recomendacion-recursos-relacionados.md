# ADR-0036 Sistema de recomendación de recursos relacionados

* Estado: Aceptado
* Fecha: 2026-08-06
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica], [@.agents/skills/busqueda-y-descubrimiento], [@.agents/skills/backend-api-servicios], [@.agents/skills/frontend-ux-accesibilidad]
* Issue: #72

## Contexto y Problema

La ficha de recurso debe sugerir **recursos relacionados** (“También te puede interesar”) para mejorar el descubrimiento y la reutilización. El mapa de capacidades (Nivel 4) y el issue #72 piden señales combinables (metadatos, texto, colecciones, keywords, autor) y un camino progresivo hasta filtrado colaborativo.

Restricciones del proyecto:

- ADR-0005: PostgreSQL como motor de datos y de capacidades de búsqueda.
- ADR-0009: perfil mínimo de metadatos (`resourceType`, `language`, subjects, levels, keywords, author).
- ADR-0026: FTS nativo con `tsvector` / `ts_rank` (sin Elasticsearch).
- Cold start realista: el catálogo puede tener pocas interacciones de usuario.
- Rendimiento objetivo: respuesta de recomendación &lt; 300 ms en catálogo medio.
- Privacidad: no exponer patrones de navegación de terceros.

## Opciones Consideradas

### Opción A — Motor externo de recomendaciones (Redis RecSys, Amazon Personalize, TensorFlow Recommenders, etc.)

* Pros: ranking sofisticado, A/B testing maduro en productos grandes.
* Contras: infraestructura y operación nuevas; lock-in; requiere volumen de eventos; sobredimensionado para el MVP y el cold start educativo.

### Opción B — Elasticsearch / OpenSearch “More Like This”

* Pros: MLT clásico y maduro; facetas potentes.
* Contras: contradice ADR-0005/0026 (evitar motor de búsqueda externo); coste operativo y sincronización de índices.

### Opción C — pgvector + embeddings (OpenAI / modelos locales)

* Pros: similitud semántica fuerte entre descripciones.
* Contras: dependencia de modelo/API o GPU; coste; latencia de indexación; no resuelve por sí solo co-ocurrencia en colecciones ni autoría; prematuro sin evaluación de calidad pedagógica.

### Opción D — Heurística multi-señal en PostgreSQL (content-based híbrido) *(elegida)*

Combinar en una sola consulta SQL (o prefiltro SQL + score en TypeScript) señales ponderadas:

1. Materias compartidas (`resource_subjects`)
2. Niveles compartidos (`resource_levels`)
3. Mismo `resourceType`
4. Mismo `language`
5. Keywords compartidos (tokenización de `keywords`)
6. Mismo autor (`created_by` o campo `author` normalizado)
7. Co-ocurrencia en colecciones (`collection_resources`)
8. Similitud textual FTS (`ts_rank` del `search_vector` del candidato frente a título+keywords del semilla)

* Pros: sin infra nueva; alinea ADR-0005/0009/0026; testeable (pesos y score puros); degrada bien en cold start; extensible a fase colaborativa sin reescribir el contrato de API.
* Contras: ranking menos “inteligente” que ML; pesos hay que tunear con CTR; FTS depende de `search_vector` poblado.

### Opción E — Solo facetas en el cliente (filtrar catálogo por materia/nivel)

* Pros: trivial.
* Contras: no usa colecciones, FTS ni autor; peor UX; no cumple el requisito de sección contextual en ficha.

## Decisión

Se adopta la **Opción D**: sistema de recomendación **content-based multi-señal** sobre PostgreSQL, con:

1. **Contrato de API**: `GET /api/v1/resources/:slug/related?limit=4..8`
2. **Score puro en TypeScript** (pesos documentados y unit-testeados) alimentado por un **vector de señales** calculado en SQL.
3. **Fase 1+2 en la misma entrega**: metadatos + keywords + autor + colecciones + FTS cuando haya `search_vector`.
4. **Fase 3 diferida** (collaborative filtering / “Recomendados para ti”): requiere volumen de favoritos, valoraciones y (futuro) vistas; se documenta como extensión sin bloquear el valor actual.
5. **UI**: sección “Recursos relacionados” (4–8 cards) y, si hay señal de autor, bloque “Más del mismo autor” con candidatos del mismo autor no ya listados en relacionados.

Referencias de dominio (no dependencias): OER Commons y MERLOT priorizan materia/nivel/keywords; catálogos académicos usan co-ocurrencia y content-based antes que CF; Wikipedia/item-item CF se reserva a alto volumen de interacciones.

## Consecuencias

### Positivas

* Valor inmediato en ficha de recurso sin ML ni servicios nuevos.
* TDD viable: la calidad del ranking se fija con asserts numéricos sobre pesos y orden.
* Evolución natural: se pueden reponderar señales o añadir CF sin romper el endpoint.
* Privacidad: solo se usan metadatos públicos y co-ocurrencia editorial en colecciones, no “usuarios que vieron X”.

### Negativas / Riesgos

* Pesos iniciales son heurísticos; hay que medir CTR de la sección.
* Si el catálogo es pobre en metadatos, el score cae a 0 y la sección se oculta (comportamiento correcto, no relleno aleatorio).
* FTS débil si `search_vector` no está indexado (mitigado: el resto de señales siguen operando).

## Notas de Implementación

### Pesos por defecto (`DEFAULT_RECOMMENDATION_WEIGHTS`)

| Señal | Peso | Notas |
|-------|------|--------|
| Materia compartida | 3.0 por materia | Capacidad pedagógica fuerte |
| Nivel compartido | 2.5 por nivel | Ajuste curricular |
| Tipo de recurso | 2.0 | Mismo formato de uso |
| Keyword compartida | 1.5 (máx. 5) | Evita dominar con listas largas |
| Co-ocurrencia colección | 2.5 (máx. 3 colecciones) | Curación editorial |
| Mismo autor | 2.0 | Bloque “Más del mismo autor” |
| Idioma | 1.0 | Preferencia de consumo |
| FTS `ts_rank` (0–1) | × 4.0 | Similitud textual (ADR-0026) |

### Reglas

* Solo candidatos `editorial_status = 'published'` y `deleted_at IS NULL`.
* Excluir el recurso semilla.
* `score > 0` obligatorio para aparecer.
* Límite por defecto 6, rango [4, 8] (query `limit` se clampea).
* Desempate estable: mayor `score`, luego `updated_at` más reciente, luego `slug` ascendente.

### Fuera de alcance de esta ADR

* Personalización por historial de sesión (“Recomendados para ti”).
* Item-item collaborative filtering.
* Embeddings / pgvector.
* Cache materializado (revisar si p99 &gt; 300 ms con catálogo real).

### Criterios de revisión

Reabrir la decisión si:

1. El CTR de la sección es sistemáticamente peor que un baseline de “misma materia”.
2. El catálogo supera el tamaño donde la consulta SQL no cumple latencia sin materialización.
3. Hay volumen suficiente de interacciones para justificar CF o embeddings con evidencia.

## Adenda 2026-11-03 — solo cuentan las colecciones publicadas (#485)

**Problema.** La co-ocurrencia en colecciones contaba cualquier fila de `collection_resources`, sin mirar el estado de la colección. Una colección en borrador, en revisión o archivada influía en qué recursos se recomendaban en la ficha pública. No se filtraba contenido no publicado (los candidatos ya son recursos publicados), sino una agrupación que todavía no es pública.

**Decisión.** La señal `collectionCooccurrence` y el filtro de candidatos solo cuentan colecciones con `editorial_status = 'published'`. Es lo que ya decía esta ADR en «Privacidad»: solo co-ocurrencia editorial pública.

**Implementación.** Un único fragmento SQL (`publishedCollectionPairs` en `apps/api/src/recommendations/service.ts`) se usa en la señal y en el filtro, para que no se desalineen.

**Validación.** `apps/api/src/recommendations/service.unit.test.ts`, «solo cuentan las colecciones publicadas (#485)»: con A y B solo relacionados por colecciones en borrador, revisión y archivada, B no sale en la ficha de A; al añadir una publicada sale con `collectionCooccurrence = 1` (rojo → verde).
