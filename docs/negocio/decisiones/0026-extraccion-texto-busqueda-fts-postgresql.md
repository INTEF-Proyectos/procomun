# ADR-0026 Extracción de texto y búsqueda Full Text Search con PostgreSQL

* Estado: Propuesto
* Fecha: 2026-05-28
* Agentes Implicados: [@.agents/skills/backend-api-servicios, @.agents/skills/arquitectura-solucion, @.agents/skills/busqueda-y-descubrimiento]

## Contexto y Problema

Procomún actual usa Elasticsearch 7.17 como motor de búsqueda. La nueva plataforma busca simplificar la arquitectura y reducir costes operativos evitando servicios externos cuando sea posible.

Se necesita ofrecer búsqueda potente sobre:
- Metadatos de recursos educativos (título, descripción, tags, autor).
- Contenido textual extraído de los archivos subidos (PDF, DOCX, HTML, SCORM, etc.).

PostgreSQL ofrece Full Text Search nativo con `tsvector`, `tsquery`, `ts_rank` y `ts_headline`, además de extensiones como `unaccent` y `pg_trgm` para tolerancia a errores y búsqueda sin tildes. Esto permite implementar la búsqueda sin añadir infraestructura adicional.

Relación con otras issues:
- Issue #30: subida por chunks. La extracción de texto se dispara al completar la subida.
- Issue #33: esta ADR documenta la decisión técnica para la issue principal.
- ADR-0025: los metadatos JSONB pueden alimentar directamente el `tsvector`.

## Opciones Consideradas

### Opción 1: Mantener Elasticsearch 7.17

Conservar el motor de búsqueda actual del Procomún legacy.

- ✅ Motor maduro con muchas funcionalidades avanzadas (fuzzy, more-like-this, aggregations).
- ✅ No requiere desarrollo de extracción propia (Elasticsearch tiene ingest pipelines).
- ❌ Elasticsearch 7.17 está en EOL; requeriría migrar a 8.x u OpenSearch.
- ❌ Infraestructura adicional: servicio separado, JVM, memoria dedicada (~1-2 GB mínimo).
- ❌ Complejidad operativa: sincronización de datos, monitorización, backups del índice.
- ❌ Coste de licencia si se usa la versión comercial.

### Opción 2: Migrar a OpenSearch

Fork open-source de Elasticsearch mantenido por AWS.

- ✅ Compatibilidad con Elasticsearch 7.x.
- ✅ Sin problemas de licencia.
- ❌ Misma complejidad de infraestructura que Elasticsearch.
- ❌ Requiere migración del cluster existente.
- ❌ Sobredimensionado para el volumen actual del catálogo (~170.000 recursos).

### Opción 3: Usar Meilisearch

Motor de búsqueda ligero y moderno, orientado a experiencia de usuario.

- ✅ Fácil de configurar, buen autocompletado, tolerancia a typos out-of-the-box.
- ✅ Bajo consumo de recursos comparado con Elasticsearch.
- ❌ Servicio adicional que mantener y monitorizar.
- ❌ Menos control sobre ranking y configuración lingüística avanzada.
- ❌ Sincronización de datos necesaria.
- ❌ Menos maduro para búsqueda facetada compleja.

### Opción 4: PostgreSQL Full Text Search (elegida)

Usar las capacidades nativas de PostgreSQL para búsqueda de texto completo.

- ✅ Sin infraestructura adicional: misma base de datos para datos y búsqueda.
- ✅ Consistencia transaccional: el índice se actualiza en la misma transacción.
- ✅ Suficiente para catálogos de tamaño medio-grande (~170.000 recursos).
- ✅ Soporte multiidioma con diccionarios (spanish, english, catalan, etc.).
- ✅ Extensiones `unaccent` y `pg_trgm` para tolerancia a tildes y typos.
- ✅ El texto extraído en bruto permite migrar a un motor externo en el futuro sin re-extraer.
- ❌ Menos funcionalidades avanzadas out-of-the-box que Elasticsearch.
- ❌ Requiere tuning manual de ranking y pesos.
- ❌ `ts_headline` es más limitado que los highlighters de Elasticsearch.
- ❌ Múltiples idiomas requieren gestión cuidadosa del diccionario por recurso.

### Opción 5: Enfoque híbrido temporal

PostgreSQL FTS como motor principal, con posibilidad de añadir un motor externo en el futuro si el volumen o las necesidades lo justifican.

- ✅ Empieza simple, escala cuando sea necesario.
- ✅ El texto extraído en bruto permite alimentar cualquier motor futuro.
- ❌ Puede requerir refactoring si se migra a un motor externo.

## Decisión

Se adopta la **Opción 4: PostgreSQL Full Text Search** como motor de búsqueda principal, con la **Opción 5** como estrategia de evolución futura.

Justificación:
- El volumen actual (~170.000 recursos) es manejable para PostgreSQL FTS con índices GIN.
- Elimina la dependencia de Elasticsearch y su complejidad operativa.
- Reduce costes de infraestructura y mantenimiento.
- La extracción de texto y almacenamiento en bruto asegura que se puede migrar a otro motor sin re-extraer contenido.
- Las extensiones `unaccent` y `pg_trgm` cubren los casos de uso más importantes (tildes, typos, similitud).

## Diseño Técnico

### Nuevos campos en el modelo de recurso

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `extracted_text` | `text` | Texto extraído en bruto del archivo. Máximo ~500 KB por recurso. |
| `search_vector` | `tsvector` | Vector de búsqueda generado combinando título, tags, descripción y texto extraído. |
| `extraction_status` | `enum` | Estado: `pending`, `processing`, `completed`, `error`, `skipped`. |
| `extracted_at` | `timestamp` | Fecha de última extracción exitosa. |
| `extraction_error` | `text` | Mensaje de error si la extracción falló. |

### Generación del `tsvector`

El vector de búsqueda combina campos con pesos diferenciados:

```sql
search_vector =
  setweight(to_tsvector(config, coalesce(title, '')), 'A') ||
  setweight(to_tsvector(config, coalesce(tags_text, '')), 'B') ||
  setweight(to_tsvector(config, coalesce(description, '')), 'C') ||
  setweight(to_tsvector(config, coalesce(extracted_text, '')), 'D')
```

Donde `config` es el diccionario correspondiente al idioma del recurso (`spanish` por defecto).

### Índices

```sql
CREATE INDEX idx_resources_search_vector ON resources USING GIN (search_vector);
CREATE INDEX idx_resources_trgm_title ON resources USING GiST (title gist_trgm_ops);
```

### Extensiones PostgreSQL requeridas

- `unaccent`: búsqueda insensible a tildes.
- `pg_trgm`: similitud por trigramas, sugerencias "quiso decir", autocompletado.

### Extracción de texto

#### Tipos de archivo soportados

| Categoría | Formatos | Estrategia de extracción |
|-----------|----------|--------------------------|
| Documentos | PDF, DOCX, ODT, PPTX, ODP, XLSX, ODS | Librerías de parsing (pdf-parse, mammoth, etc.) |
| Web/texto | HTML, EPUB, TXT, MD, CSV | Parsing directo / strip HTML |
| Paquetes educativos | SCORM | Extraer manifiesto imsmanifest.xml + HTML internos |
| Multimedia | Vídeo, audio, imagen | Extraer metadatos embebidos, subtítulos si existen |

#### Flujo de extracción

1. El usuario completa la subida del archivo (incluyendo subida por chunks, issue #30).
2. Se crea un job asíncrono de extracción con estado `pending`.
3. El worker procesa el job:
   - Cambia estado a `processing`.
   - Extrae texto según tipo de archivo.
   - Trunca a ~500 KB si excede el límite.
   - Almacena en `extracted_text`.
   - Regenera `search_vector`.
   - Cambia estado a `completed` (o `error` si falla).
4. Si el recurso se actualiza (archivo o metadatos), se dispara reextracción/reindexación.

#### Herramientas de extracción a evaluar

- **pdf-parse** / **pdf.js**: extracción de texto de PDF.
- **mammoth**: DOCX a texto/HTML.
- **cheerio**: parsing de HTML.
- **epub-parser** o similar: EPUB.
- **adm-zip** / **jszip**: descomprimir SCORM y acceder a HTML internos.
- **music-metadata** / **exiftool**: metadatos de multimedia.

La selección final se hará durante la implementación, priorizando compatibilidad con Bun y bajo overhead.

### Búsqueda

#### Query básica

```sql
SELECT id, title, ts_rank(search_vector, query) AS rank,
       ts_headline(config, description, query) AS snippet
FROM resources,
     websearch_to_tsquery(config, :search_term) AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 20 OFFSET :offset;
```

#### Ranking avanzado (fase posterior)

Factores adicionales de ranking a implementar progresivamente:

- **Popularidad**: `ts_rank(...) * (1 + log(1 + views_count + favorites_count))`.
- **Frescura**: decay exponencial sobre fecha de publicación.
- **Completitud de metadatos**: bonus por campos rellenos (descripción, tags, licencia, nivel educativo).

### Reindexación

- **Automática**: al crear/actualizar recurso o sus metadatos.
- **Manual individual**: endpoint de administración para reindexar un recurso específico.
- **Masiva**: comando/script para reindexar todos los recursos (útil al cambiar configuración FTS o diccionarios).

## Privacidad y Seguridad

- El texto extraído hereda las mismas restricciones de acceso que el recurso original.
- Las queries de búsqueda SOLO devuelven recursos visibles para el usuario que busca.
- `ts_headline` no se aplica sobre texto extraído de recursos con acceso restringido para usuarios sin permisos.
- El texto extraído puede contener información sensible del documento original; se aplican las mismas políticas de protección de datos.
- No se expone el campo `extracted_text` completo en la API pública; solo snippets controlados vía `ts_headline`.

## Observabilidad

- Registrar errores de extracción con tipo de archivo, tamaño y mensaje de error.
- Registrar búsquedas realizadas (anonimizadas) para detectar gaps en el catálogo.
- Registrar búsquedas sin resultados para alimentar curación y sinónimos.
- Métricas básicas: tiempo medio de extracción por tipo de archivo, tasa de error, queries por segundo.
- Estas métricas se implementarán progresivamente según la infraestructura de observabilidad disponible.

## Fases de Implementación

### Fase 1 (alcance inicial)

- Añadir campos al modelo de datos (`extracted_text`, `search_vector`, `extraction_status`, etc.).
- Implementar extracción básica para tipos de archivo principales (PDF, DOCX, HTML, TXT, MD).
- Generar `tsvector` con pesos diferenciados.
- Crear índice GIN.
- Endpoint de búsqueda básico con `tsquery` + `ts_rank`.
- Extracción asíncrona en background job.
- Reindexación automática al actualizar recurso.
- Extensiones `unaccent`.
- Idioma español como diccionario por defecto.

### Fase 2 (posterior)

- Soporte de extracción para SCORM, EPUB, ODP, ODS.
- Extensión `pg_trgm` para sugerencias "quiso decir" y autocompletado.
- Ranking con boost por popularidad, frescura y completitud.
- Búsqueda facetada con conteos dinámicos.
- Búsqueda por similitud ("Más como este").
- Diccionarios por idioma del recurso.
- Log de queries anonimizado y métricas de búsqueda.
- Zero results handling con sugerencias alternativas.

### Fase 3 (si es necesario)

- Evaluación de migración a motor externo si PostgreSQL FTS no escala.
- El campo `extracted_text` en bruto permite alimentar cualquier motor sin re-extraer.

## Consecuencias

### Positivas

- Eliminación de Elasticsearch como dependencia de infraestructura.
- Menor coste operativo y complejidad de despliegue.
- Consistencia transaccional entre datos y búsqueda.
- Arquitectura más simple y fácil de mantener.
- Preparado para escalar a motor externo si es necesario gracias al texto en bruto.
- Búsqueda sobre contenido real de los archivos, no solo metadatos.

### Negativas / Riesgos

- PostgreSQL FTS es menos potente que Elasticsearch para funcionalidades avanzadas (aggregations complejas, geolocalización, ML ranking).
- El tuning de relevancia requiere más esfuerzo manual.
- La gestión de múltiples idiomas es más compleja que en Elasticsearch.
- La extracción de texto consume CPU y puede generar colas largas en cargas masivas.
- El almacenamiento de texto extraído aumenta el tamaño de la base de datos (~500 KB × 170.000 = ~85 GB en el peor caso teórico, aunque la mayoría de recursos serán mucho más pequeños).
- Si se cambia el diccionario o configuración FTS, la reindexación masiva puede ser costosa.

## Criterios de Aceptación

- [ ] Existe un campo `extracted_text` en el modelo de recurso.
- [ ] Existe un campo `search_vector` de tipo `tsvector` con índice GIN.
- [ ] La extracción de texto es asíncrona y no bloquea la subida.
- [ ] Se soporta extracción de al menos PDF, DOCX, HTML, TXT y MD.
- [ ] La búsqueda usa `tsquery` con ranking por relevancia.
- [ ] El diccionario por defecto es `spanish`.
- [ ] La extensión `unaccent` está habilitada.
- [ ] Los recursos actualizados se reindexa automáticamente.
- [ ] Existe un mecanismo de reindexación masiva.
- [ ] El texto extraído respeta las mismas restricciones de acceso que el recurso.
