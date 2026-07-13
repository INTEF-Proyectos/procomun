# ADR-0029 Importador automático de recursos legacy Procomún (.elpx)

* Estado: Aceptado
* Fecha: 2026-07-10
* Agentes Implicados: [@.agents/skills/ingestas-y-migraciones, @.agents/skills/backend-api-servicios, @.agents/skills/metadatos-y-curacion, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

La plataforma legacy "Procomún" (Drupal + Agrega3, en producción) contiene aproximadamente 78.800 ODEs (Objetos Digitales Educativos) y ~100.000 adjuntos multimedia. La matriz de decisión funcional (`docs/casos/matriz-decision-funcional-procomun/README.md`, filas F2-07/F2-08/F2-09, prioridad P0) y el roadmap de producto (Fase 2) marcan la migración de recursos legacy como bloqueante, pero hasta ahora no existía ninguna épica ni ADR que abordara cómo importarlos.

Se dispone de un ejemplo real de exportación (`ode-export/`, directorio local no versionado): 9 pares `<id>.json` + `<id>.elpx`, donde el `.json` contiene ~39 campos de metadatos tipo LOM/Dublin Core y el `.elpx` es un paquete eXeLearning (ZIP) ya soportado nativamente por `procomun-ng`. No existe documentación contractual completa del formato de exportación (el PPT del expediente `CE01698/2023` sigue pendiente de obtener); el esquema se ha inferido de los 9 ejemplos reales, lo cual es un supuesto de trabajo, no una especificación cerrada.

Durante el análisis se confirmó además un bug real en `packages/db/src/elpx-metadata.ts`: `METADATA_KEYS` esperaba las claves `license`/`lom_general_language`, pero los `content.xml` reales (tanto los 9 ejemplos legacy como los fixtures de test ya existentes) usan `pp_license`/`pp_lang`. Esto hacía que `language` no se extrajera nunca y `license` solo por casualidad en un subconjunto de casos, afectando no solo al importador sino también al flujo de subida manual en producción.

## Opciones Consideradas

* Opción A: Abordar de una sola vez todos los formatos legacy (SCORM, ePUB, IMS, enlaces, `.elpx`) en un único importador genérico.
* Opción B: Limitar la iteración 1 a recursos `.elpx` (único formato ya soportado por `procomun-ng`), dejando el resto de formatos como iteraciones futuras documentadas explícitamente como fuera de alcance.
* Opción C (transaccionalidad): una única transacción atómica de base de datos para todo el lote de importación.
* Opción D (transaccionalidad, elegida): una transacción de base de datos por registro, con idempotencia garantizada por un índice único en BD, permitiendo reintentos parciales sin rehacer el lote completo.
* Opción E (parser): reescribir desde cero el parseo/extracción de `.elpx`.
* Opción F (parser, elegida): reutilizar íntegramente `apps/api/src/services/elpx-processor.ts` y `elpx-safe-extract.ts` (extracción segura ya endurecida por ADR-0026a), corrigiendo únicamente el bug de claves de metadatos detectado.

## Decisión

Se adopta la Opción B + D + F:

1. **Alcance de la iteración 1**: solo recursos `.elpx`. SCORM/ePUB/IMS/enlaces quedan fuera, pendientes de decisión de negocio con INTEF sobre qué formatos son obligatorios de preservación (F2-09).
2. **Reutilización de infraestructura existente**: el importador no reimplementa el parseo ni la extracción segura de `.elpx`; usa `parseElpxMetadata`/`processElpxUpload`/`safeExtractElpx` y el repositorio `elpx_projects` ya existentes.
3. **Idempotencia a nivel de base de datos**: se añade un índice único parcial `(import_source, external_id) WHERE external_id IS NOT NULL` sobre `resources`, de forma que reejecutar el importador sobre el mismo origen nunca duplica recursos — los ya existentes se cuentan como omitidos, no como error.
4. **Transacción por registro, no por lote global**: cada recurso se inserta en su propia transacción (`resources` + `resource_subjects` + `resource_levels` + `elpx_projects` + `media_items` + `upload_sessions`). Un fallo en un registro no arrastra a los demás del lote procesado.
5. **`resources.importedAt` se reinterpreta** como fecha de publicación original en el sistema legacy (`publicationDate`/`fechaRegistro`), no como el instante de ejecución del importador — ese instante queda cubierto por `createdAt` (autogenerado) y por el informe de ejecución (`informe_ingesta.json`).
6. **Corrección del bug de metadatos** (`pp_license`/`pp_lang`) es prerrequisito de esta iteración, no solo una mejora colateral: sin él, prácticamente ningún recurso importado tendría `language`/`license` correctos.
7. **`editorialStatus: "draft"` por defecto** para todo lo importado: ningún recurso legacy se publica automáticamente, queda pendiente de curación editorial.

## Consecuencias

### Positivas
* Reutiliza al máximo la infraestructura de subida/extracción ya auditada (ADR-0026a, ADR-0027) en vez de duplicar lógica de seguridad sensible.
* El importador es seguro de reejecutar: útil tanto para el piloto de 9 ejemplos como para futuras cargas incrementales del volumen real.
* Corrige un bug de producción (extracción de `license`/`language`) que afectaba también al flujo manual de subida, no solo a la migración.
* Dedica el modelo de datos existente (`externalId`, `sourceUri`, `importedAt`, `importSource`) a su propósito original, hasta ahora sin uso real en producción.

### Negativas / Riesgos
* El esquema de origen está inferido de solo 9 ejemplos; el volumen real (78.800 ODEs) puede exhibir variantes de formato no vistas en la muestra.
* Deja fuera SCORM/ePUB/IMS y la migración de usuarios/autoría real (F2-08/F2-09), que requieren decisiones de negocio pendientes con INTEF.
* No indexa el contenido interno del `.elpx` para FTS en esta iteración — los recursos importados solo son buscables por metadatos.
* `knowledgeArea`/`learningContext` se guardan como texto libre (igual que el resto del sistema hoy, `taxonomies` sigue desconectada de `resources`), sin normalizar contra un vocabulario controlado — riesgo de fragmentación de materias/niveles.
* Con `editorialStatus: "draft"` por defecto, un volumen alto de importación puede generar una cola de revisión editorial muy grande.

## Notas de Implementación

* Ver `docs/epics/epic-004-migracion-legacy-procomun/` para el desglose de tareas, el mapeo de campos completo y las métricas de calidad esperadas del piloto.
* Comando CLI: `apps/cli/src/commands/import-legacy-procomun.ts` (`import:legacy-procomun`), con modo `--dry-run` para validar sin escribir en BD.
* Módulos de mapeo/normalización en `packages/db/src/legacy-import/`.
* Antes de ejecutar sobre el volumen real (Fase 3 del plan de ejecución), deben resolverse con INTEF: alcance completo vs. selectivo de la migración, tratamiento de usuarios/autoría histórica, y formatos legacy adicionales obligatorios.

## Actualización 2026-07-10 — `editorialStatus` de recursos importados

### Decisión revisada
El punto 7 de la Decisión original ("`editorialStatus: 'draft'` fijo") queda sustituido: los recursos importados desde Procomún legacy se crean directamente con `editorialStatus: "published"`, no `"draft"`. Motivo: son recursos que ya estaban publicados y editorialmente curados en la plataforma de origen; mantenerlos ocultos tras la importación no aporta valor y generaría una cola de revisión editorial innecesaria (riesgo ya anotado en la sección "Negativas / Riesgos" de esta ADR, que queda resuelto con este cambio).

### Consecuencias de la revisión
* Los recursos importados son visibles públicamente desde el momento de la importación, sin paso previo por `review`.
* No se fija `curatedAt`/`assignedCuratorId` al importar (mismo patrón que `packages/db/src/seed-data.ts`, que también crea recursos `published` sin pasar por el flujo de curación).
* Implementado en `packages/db/src/repository/legacy-import.ts` (`importLegacyResourceWithElpx`), con test de regresión en `packages/db/src/repository.unit.test.ts` que verifica `editorialStatus === "published"`.

## Actualización 2026-07-10 — correcciones de la revisión del PR #268

La revisión del PR ([GitHub #268](https://github.com/INTEF-Proyectos/procomun/pull/268), revisor `erseco` + bot Codex) encontró 8 problemas reales sobre la implementación inicial. Todos corregidos en la misma iteración, con tests de regresión (unitarios e integración con fixtures reales):

1. **[P1] `createdAt` desplazaba el orden del catálogo público.** `resources.createdAt` se fijaba al instante de ejecución del import; como `listResources()` ordena por `createdAt DESC`, una importación completa habría hecho aparecer todo el catálogo legacy como "recién creado", desplazando contenido genuinamente reciente. Fix: `createdAt = importedAt ?? now` en `importLegacyResourceWithElpx` — se conserva la cronología histórica real, con fallback solo si no pudo resolverse ninguna fecha de origen.
2. **[P2] Un `.json` malformado abortaba todo el lote.** La lectura+parseo del `.json` ocurría fuera del `try/catch` por registro. Fix: nueva función `resolvePairs()` que lee y parsea cada `.json` capturando errores por par (`ResolvedPair.parseError`); el bucle principal reporta esos casos como `error` para ese registro concreto sin detener el resto.
3. **[P2] Los recursos importados no quedaban indexados para búsqueda.** No se llamaba a `updateSearchVector()`, así que eran invisibles en `/api/v1/search` hasta un `fts:reindex` manual. Fix: se llama a `updateSearchVector(db, resourceId)` tras persistir cada recurso (mismo helper que usa la creación manual de recursos), de forma *best-effort* — un fallo de indexación no bloquea la importación, queda como warning tolerable.
4. **[P2] `elpx_projects.hash` era un UUID aleatorio, no el checksum del contenido.** La deduplicación secundaria por contenido documentada en esta ADR (sección "Decisión", punto 3) no funcionaba de verdad. Fix: se pasa `{ hash: checksumSHA256 }` explícitamente a `processElpxUpload()`.
5. **[P2] Directorios de extracción huérfanos si fallaba la persistencia.** Si `processElpxUpload()` tenía éxito pero la inserción en BD fallaba después, el `extractPath` quedaba en disco sin referencia. Fix: se limpia con `removeElpxExtraction()` en el `catch`, pero **solo si ningún otro `elpx_project` ya usa ese hash** (`getElpxProjectByHash`) — necesario porque, tras el fix del punto 4, un fallo por hash duplicado significa que el directorio pertenece legítimamente al recurso ya persistido con ese mismo contenido.
6. **[P2] Los fallbacks de campos no cubrían cadenas vacías.** `idODE ?? id` y `rutaAccesoContenidos ?? technicalLocationStr` solo activaban el fallback si el valor principal era `null`/`undefined`, no `""`. Fix: ambos usan ahora `firstNonEmpty()`, igual que el resto de fallbacks del mapeo.
7. **[P2] `--only <externalId>` filtraba por nombre de fichero, no por el `externalId` real.** El nombre exportado solo coincide con `idODE` en la muestra observada. Fix: `resolvePairs()` resuelve el `externalId` real leyendo cada `.json` antes de aplicar el filtro `--only`.
8. **[P2] Los valores mapeados no respetaban los límites de columna del destino.** `resourceType` (`varchar(100)`), materias (`varchar(255)`), niveles (`varchar(100)`) y `keywords` (límite de aplicación de 1000 caracteres) podían recibir un valor legacy más largo y provocar un error de inserción en vez del truncado tolerable que el diseño ya prometía. Fix: truncado explícito con warning en `field-mapper.ts` para los cuatro campos.

Ninguno de estos cambios altera el alcance ni las decisiones estructurales de la ADR original (reutilización de `elpx-processor.ts`, transacción por registro, `editorialStatus: "published"`); son correcciones de implementación sobre esa misma base. Verificado con `bun test` completo del monorepo (794/794) y una re-ejecución del piloto sobre los 9 ejemplos de `ode-export/` (entorno temporal aislado): mismos resultados que el piloto original (8 importados, 1 bloqueado, 0 errores), con `createdAt` reflejando ahora la fecha de publicación original de cada recurso y `search_vector` poblado en los 8.

## Actualización 2026-07-11 — segunda ronda de revisión del PR #268 (3 hallazgos más)

Tras el commit anterior, el revisor mantuvo `CHANGES_REQUESTED` señalando que la implementación de esos 8 fixes introducía 3 problemas nuevos, más un hallazgo colateral (bug de regresión en la previsualización) detectado por el usuario al probar manualmente:

1. **[P1] `resolvePairs()` no escalaba al volumen real (~78.800 recursos).** Leía y retenía en memoria todos los JSON antes de aplicar `--only`/`--limit`, por lo que `--limit 1` igualmente parseaba el lote completo. Fix: `resolvePairs()` se sustituye por `iterateResolvedPairs()`, un generador async (`AsyncGenerator`) consumido con `for await...of` en `runImportLegacyProcomun`, que corta (`break`) en cuanto `--only` encuentra su objetivo o `--limit` alcanza su cupo — por semántica de generadores de JS, el resto de ficheros nunca se leen. Test de regresión: se cuenta cuántas veces se invoca el resolver de `externalId` inyectado tras pedir solo 2 de 3 elementos del generador, confirmando que el tercero nunca se procesa.
2. **[P1] La extracción del `.elpx` ocurría sobre una ruta que podía estar en uso.** Al fijar `elpx_projects.hash` al checksum del contenido, dos recursos con el mismo `.elpx` comparten la misma ruta de extracción (`storageDir/elpx/<checksum>`). El fix anterior comprobaba duplicados **después** de extraer (en el `catch`), pero `safeExtractElpx()` hace rollback destructivo de `extractPath` si la extracción falla a mitad de camino — pudiendo borrar la preview de un recurso ya persistido con ese hash si el `processed` de la ronda anterior nunca llegaba a asignarse. Fix: `getElpxProjectByHash()` se comprueba **antes** de llamar a `processElpxUpload()`; si el hash ya existe, se lanza un error explícito sin extraer nada, y el recurso existente queda intacto. Como consecuencia, la limpieza en el `catch` ya no necesita volver a comprobar el hash (un fallo posterior a una extracción exitosa no puede ser ya un choque de hash, así que se limpia sin condición).
3. **[P2] La documentación de rollback quedó desactualizada tras el fix del punto 1 de la ronda anterior.** Proponía filtrar por `importSource` + rango de `createdAt`, pero ese campo ahora contiene la fecha histórica de publicación, no el instante de la ejecución, así que no identifica los recursos de un `runId` concreto. Fix (solo documental, sin cambio de código): `design.md` ahora indica usar los `resourceId` de los registros `outcome: "imported"` del propio informe de ejecución (`informe_ingesta-<runId>.json`) como fuente de verdad para el rollback, con `upload_sessions.createdAt` (no afectado por el cambio de semántica) como alternativa de último recurso si el informe se perdiera.

**Hallazgo colateral encontrado por el usuario al probar manualmente** (no parte de la revisión del PR, pero causado por el fix #4 de la ronda anterior): la ruta de previsualización de `.elpx` (`apps/api/src/routes/elpx-content.ts`) validaba el hash con un patrón `{8,40}` caracteres (pensado para UUID o SHA-1), que rechazaba con 404 los hashes SHA-256 (64 caracteres) que ahora genera el importador legacy. Corregido ampliando el patrón a `{8,64}` (coincide con `elpx_projects.hash varchar(64)`), con test de regresión que sirve contenido real bajo un hash de 64 caracteres.

Validación: `bun test` completo del monorepo (796/796, +2 tests nuevos) y re-ejecución de los tests de integración de deduplicación por contenido, confirmando que el mensaje de error del registro fallido ahora indica explícitamente "no se vuelve a extraer" (prueba de que la detección ocurre antes de la extracción, no como fallo de inserción posterior).

## Actualización 2026-07-13 — tercera ronda de revisión del PR #268: condición de carrera (TOCTOU) en la deduplicación por hash

El fix del punto 2 de la ronda anterior (comprobar `getElpxProjectByHash()` antes de extraer) resolvía el caso secuencial, pero el revisor señaló que **no es atómico**: dos ejecuciones concurrentes del importador (dos procesos CLI corriendo a la vez, o dos llamadas paralelas) podrían ambas comprobar que un hash no existe todavía, ambas extraer sobre `storageDir/elpx/<checksum>` (la misma ruta física, porque estaba basada en el checksum), y cuando una de las dos inserciones ganase la restricción única de `elpx_projects.hash` y la otra fallase, el bloque `catch` de la perdedora — que tras el fix anterior limpiaba el `extractPath` sin comprobación adicional, asumiendo que un choque de hash ya se había descartado antes de extraer — borraría el directorio compartido, incluida la preview del recurso que sí se había persistido con éxito.

### Decisión revisada

Se desacopla la **ruta física de extracción** del **valor lógico de deduplicación**:

* `processElpxUpload(storagePath, config.storageDir, { hash: uploadId })` — la ruta de extracción (`storageDir/elpx/<uploadId>`) se basa en el `uploadId` generado por cada intento (`crypto.randomUUID()`, único por llamada), no en el checksum del contenido. Dos intentos, aunque tengan el mismo contenido, **nunca** comparten ruta física.
* Al persistir, `elpx_projects.hash` sigue guardando el **checksum SHA-256 real** (no `processed.hash`, que ahora vale `uploadId`) — la deduplicación de contenido en BD sigue intacta y sigue siendo atómica, porque la garantiza la restricción `UNIQUE` del motor de base de datos, no una comprobación previa en aplicación.
* La comprobación previa `getElpxProjectByHash()` se mantiene como optimización (evita extraer contenido ya conocido en el caso común, no concurrente), pero deja de ser la única defensa.
* En el `catch`, la limpieza de `extractPath` vuelve a ser incondicional — y ahora es **siempre segura**, porque la ruta es intrínsecamente exclusiva del intento que falló; jamás puede coincidir con la de otro intento, gane o pierda la carrera.

### Consecuencias
* Bajo una carrera real, ambos intentos extraen su propia copia física del contenido (duplicación temporal de I/O en el caso raro de colisión concurrente), pero solo uno persiste su fila en BD; el otro limpia su propio directorio sin riesgo.
* Test de regresión unitario (mocks): dos llamadas a `runImportLegacyProcomun` con `Promise.all`, simulando que ambas ven `getElpxProjectByHash() → null`; verifica que la ruta limpiada es siempre la del intento perdedor, nunca la del ganador. Confirmado que el test falla con el código anterior (revertido temporalmente para verificarlo) y pasa con el fix.
* Test de integración con concurrencia real (PGlite + storage real, sin mocks): dos ejecuciones de `runImportLegacyProcomun` lanzadas con `Promise.all` sobre un `.elpx` sintético idéntico bajo dos `externalId`; confirma en el log que la carrera ocurre de verdad (el registro perdedor falla por la restricción única real de BD, no por el pre-check) y que la preview del recurso ganador permanece íntegra.

Validación: `bun test` completo del monorepo (798/798, +2 tests nuevos) y `check-test-files.ts` sin incidencias.
