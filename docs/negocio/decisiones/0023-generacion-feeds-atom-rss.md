# ADR-0023 Librería para generación de feeds Atom/RSS

* Estado: Aceptado
* Fecha: 2026-05-26
* Agentes Implicados: [@.agents/skills/backend-api-servicios, @.agents/skills/interoperabilidad-educativa]

## Contexto y Problema

La plataforma necesita generar feeds Atom 1.0 y RSS 2.0 para sindicar recursos educativos publicados. Se requiere una solución ligera, compatible con TypeScript y Bun, que soporte ambos formatos y facilite la inclusión de metadatos educativos como categorías.

## Opciones Consideradas

### Opción 1: `feed` (npm)
- Librería madura (>1M descargas/mes), genera Atom 1.0, RSS 2.0 y JSON Feed 1.0.
- API declarativa y tipada en TypeScript.
- Soporte nativo de categorías, autores, imágenes, enlaces de paginación.
- Sin dependencias externas.
- Última versión: 5.2.1, sin vulnerabilidades conocidas.

### Opción 2: Generación manual de XML
- Control total sobre la salida XML.
- Sin dependencias adicionales.
- Mayor esfuerzo de implementación y mantenimiento.
- Riesgo de errores de escapado XML y no conformidad con RFC 4287/RSS 2.0.

### Opción 3: `rss` (npm)
- Genera solo RSS 2.0, no soporta Atom 1.0 nativamente.
- Menos mantenida que `feed`.
- No cubre el requisito de Atom como formato principal.

## Decisión

Se elige **`feed` v5.2.1** por ser la opción más completa, ligera y mantenida. Soporta los dos formatos requeridos (Atom 1.0 y RSS 2.0) con una API tipada que reduce errores. No tiene vulnerabilidades conocidas y es compatible con Bun.

## Consecuencias

### Positivas
* Implementación rápida con API de alto nivel.
* Conformidad garantizada con RFC 4287 (Atom) y RSS 2.0.
* Soporte de categorías para mapear metadatos educativos (nivel, materia).
* Sin dependencias transitivas que gestionar.

### Negativas / Riesgos
* Dependencia externa (mitigado: librería estable y sin dependencias propias).
* Si se necesita personalización XML muy específica en el futuro, podría requerir extensión manual.

## Notas de Implementación

1. Instalar `feed` como dependencia de `@procomun/api`.
2. Crear servicio de feeds en `apps/api/src/feeds/` con lógica de serialización.
3. Crear rutas bajo `/feeds/atom/` y `/feeds/rss/` para los distintos tipos de feed.
4. Implementar paginación con enlaces `next`/`previous` según RFC 5005.
5. Cachear respuestas con `Cache-Control: public, max-age=3600`.
6. Solo incluir recursos con `editorialStatus: "published"`.
