# Design — Recursos relacionados

* Issue: #72
* ADR: ADR-0036
* Fecha: 2026-08-06

## Componentes

| Capa | Pieza |
|------|--------|
| API | `apps/api/src/recommendations/score.ts` — pesos, tokenización, score puro |
| API | `apps/api/src/recommendations/service.ts` — señales SQL + ranking |
| API | `GET /api/v1/resources/:slug/related` en `public.ts` |
| Frontend | Carga en `ResourceDetailIsland` + grid de `ResourceCard` |
| i18n | Claves `detail_related_*` / `detail_same_author_*` en 5 locales |

## Flujo

```
Ficha /recurso?slug=X
  → GET /api/v1/resources/X
  → GET /api/v1/resources/X/related?limit=6
  → score > 0 → sección “Recursos relacionados”
  → sameAuthor (si hay) → sección “Más del mismo autor”
```

## Contrato API

`GET /api/v1/resources/:slug/related?limit=6`

### 200

```json
{
  "data": [
    {
      "id": "...",
      "slug": "...",
      "title": "...",
      "description": "...",
      "resourceType": "documento",
      "language": "es",
      "license": "cc-by",
      "author": "Ana",
      "score": 8.5,
      "signals": {
        "sharedSubjects": 1,
        "sharedLevels": 0,
        "sameResourceType": true,
        "sameLanguage": true,
        "sharedKeywords": 2,
        "sameAuthor": false,
        "collectionCooccurrence": 1,
        "ftsRank": 0.12
      }
    }
  ],
  "sameAuthor": [],
  "limit": 6
}
```

### Errores

* 400: slug vacío
* 404: recurso no encontrado o no visible

## Ranking

1. SQL calcula el vector de señales por candidato publicado (excluye semilla).
2. `computeRecommendationScore(signals)` aplica pesos de ADR-0036.
3. Filtra `score > 0`, ordena, toma `limit`.
4. `sameAuthor`: hasta 4 recursos con `sameAuthor` y no ya en `data`.

## Pruebas

* Unitarias puras: tokenización, pesos, score, clamp, orden, desempate.
* Servicio con PGlite: fixtures de subjects/levels/keywords/autor/colección/FTS y asserts de orden.
