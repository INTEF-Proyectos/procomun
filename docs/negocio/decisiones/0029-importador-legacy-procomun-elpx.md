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

## Actualización 2026-07-16 — cuarta ronda de revisión del PR #268: desalineación de la ruta de preview y recuperabilidad tras caída del proceso

El fix de la ronda anterior (rutas de extracción únicas por `uploadId`) resolvía la condición de carrera, pero introdujo un problema distinto: la ruta física de extracción (`storageDir/elpx/<uploadId>`) y el identificador público de la preview (`elpx.hash`, el checksum) dejaron de coincidir. Como `buildElpxPreview()` construye la URL pública a partir de `elpx.hash` y `elpx-content.ts` resuelve esa URL reconstruyendo `storageDir/elpx/<hash>` por convención (igual que el resto de flujos de subida, `uploads.ts`/`admin/elpx.ts`), **toda preview importada devolvía 404** pese a que `hasPreview: true` quedaba persistido.

### Primer intento (insuficiente): promoción por `rename()` antes del commit en BD

Se corrigió promocionando el directorio de extracción a su nombre final por checksum con un `rename()` atómico, usándolo también como nueva defensa TOCTOU (el `rename()` sobre un destino ya existente y no vacío falla con `ENOTEMPTY`/`EEXIST` en vez de sobrescribir). El revisor confirmó que el bug de la preview quedaba resuelto, pero señaló un nuevo hallazgo [P1]: si el proceso se interrumpe (kill, caída del host) **después** de ganar el `rename()` pero **antes** de que la transacción de BD confirme, queda un directorio huérfano en `storageDir/elpx/<checksum>` sin ninguna fila en `elpx_projects`. Cualquier reintento futuro de importar ese mismo contenido pasaría el pre-check (`getElpxProjectByHash()` no encuentra fila), extraería en una nueva ruta privada y fallaría el `rename()` contra el huérfano — bloqueando permanentemente esa importación sin intervención manual, justo el modo de fallo que la garantía de idempotencia del importador pretende evitar.

### Decisión final: la restricción UNIQUE decide antes que el `rename()`

Se invierte el orden: la inserción en BD (`importLegacyResourceWithElpx`, con `elpx.hash = checksum` y `elpx.extractPath` ya fijado a la ruta **final** por checksum, aunque el `rename()` todavía no haya ocurrido) pasa a ejecutarse **antes** de promocionar físicamente el directorio. Es la restricción `UNIQUE` de `elpx_projects.hash`, atómica por diseño del motor de base de datos, la que decide de forma recuperable quién es el dueño legítimo de un checksum — no un `rename()` de filesystem.

Consecuencia práctica: una vez que la inserción confirma, **cualquier directorio ya presente en la ruta final solo puede ser basura huérfana** de una ejecución anterior interrumpida en ese mismo punto (nunca de un competidor legítimo, porque la restricción UNIQUE impide que dos filas compartan checksum). `promoteElpxExtractionPath()` puede entonces reclamarlo con seguridad: si el `rename()` falla con `ENOTEMPTY`/`EEXIST`, borra el destino huérfano y reintenta una vez. La promoción pasa a ser *best-effort* tras el commit (igual que la indexación de `search_vector`): un fallo se registra como warning, nunca como error de todo el registro, porque una reejecución no volverá a intentarlo (`findLegacyResourceByExternalId` ya lo encontrará como importado).

El (mucho más estrecho) hueco residual — el propio proceso cae justo entre el commit y su `rename()` — dejaría una fila persistida y publicada (`hasPreview: true`) con la extracción física todavía en su ruta privada por `uploadId`, sin bloquear ninguna importación futura (ni de ese recurso, que ya quedó idempotentemente marcado como importado, ni de ese contenido bajo otro `externalId`, que se detecta correctamente como duplicado). Los bytes no se pierden en ningún caso: quedan tanto en la ruta privada de extracción como en el `.elpx` original conservado como `media_item` (`storageKey: legacy-import/<uploadId>/...`). Cerrar ese hueco por completo exigiría un mecanismo de reconciliación dedicado (relacionar `elpx_projects.uploadSessionId` con la ruta privada pendiente de promoción); se documenta como deuda técnica abierta, no bloqueante para el volumen piloto.

### Otro hallazgo de la misma ronda: fechas de calendario imposibles se normalizaban en silencio

`parseFechaRegistro()` (formato legacy `YYYYMMDD`) y el fallback ISO de `publicationDate` solo comprobaban que `Date.UTC()`/`new Date()` no devolviera `NaN`. JavaScript no rechaza componentes de calendario imposibles: `Date.UTC(2023, 1, 31)` ("31 de febrero") no da `NaN`, se normaliza silenciosamente a "3 de marzo". Como `importedAt` también se usa como `resources.createdAt` (ver Decisión, punto 5, y la actualización 2026-07-10), esto podía corromper en silencio la cronología del catálogo público a partir de datos legacy corruptos. Fix: `isStrictCalendarDate()` valida por *round-trip* (reconstruye la fecha y comprueba que año/mes/día coinciden con los pedidos) tanto en `parseFechaRegistro()` como en el componente de fecha de `publicationDate`, antes de aceptar el valor; si no coincide, se rechaza y se cae al siguiente fallback disponible (o a `null`).

### Actualización de la sección "Rutas de extracción únicas por intento"

El texto de la actualización 2026-07-13 (más arriba) describe la ruta física de extracción como permanentemente privada por `uploadId` y nunca promocionada. Eso ya no es así: sigue siendo privada **durante la extracción**, pero se promociona a `storageDir/elpx/<checksum>` inmediatamente después de que la fila en BD confirme, y esa es la ruta que queda persistida en `elpx_projects.extractPath` y la que resuelve la URL pública de preview.

### Consecuencias
* Test de integración con HTTP real: se monta `elpxContentRoutes` y se solicita la URL pública de preview generada tras una importación real, verificando `200` — no solo que `extractPath/content.xml` exista en disco (esa comprobación, por sí sola, no habría detectado el bug del que arranca esta actualización).
* Test de regresión de recuperabilidad: se siembra un directorio huérfano en `storageDir/elpx/<checksum>` sin fila en BD y se confirma que una importación nueva de ese mismo contenido lo reclama y se completa con éxito, en vez de fallar permanentemente.
* Test de regresión de fechas: `fechaRegistro`/`publicationDate` con 31 de febrero, mes 13 y 29 de febrero en año no bisiesto se rechazan (caen al siguiente fallback o a `null`); un 29 de febrero en año bisiesto sigue aceptándose.
* El test de la carrera concurrente (TOCTOU, actualización 2026-07-13) se adapta al nuevo orden: ambas ejecuciones concurrentes llegan ahora a `importLegacyResourceWithElpx()`, y es la restricción UNIQUE (real, con PGlite, en el test de integración) la que decide — no el orden de extracción en disco.

Validación: `bun test` completo del monorepo (807/807) y `check-test-files.ts` sin incidencias.

## Actualización 2026-07-16 (2) — resolución de la combinación de licencia ND+SA en vez de bloquear

Tras revisar el informe de una importación real (826 pares, 101 bloqueados), el usuario confirmó una observación: 99 de los 101 bloqueos comparten exactamente la misma cadena de origen, `"creative commons: attribution - non derived work - non commercial - share alike"` — no son 99 problemas distintos, sino un único patrón sistemático del origen legacy.

### Decisión

`ND` (no derivadas) y `SA` (compartir igual) son mutuamente excluyentes en las licencias Creative Commons reales: `ND` prohíbe crear obras derivadas; `SA` exige que las obras derivadas se liberen con la misma licencia. No puede haber una obra derivada que a la vez esté prohibida y deba compartirse igual — es una contradicción lógica, no una combinación que Creative Commons simplemente no haya definido todavía. Por eso `VALID_LICENSES` (`packages/db/src/validation.ts`) nunca ha tenido una séptima variante `cc-by-nc-nd-sa`: no existe tal licencia, ni existirá.

Se confirma con el usuario que la cadena de origen es, casi con toda seguridad, un error de captura en el formulario de origen legacy (ambas casillas "no derivadas" y "compartir igual" marcadas a la vez, cuando nunca deberían coexistir), y se decide: **cuando `normalizeLicense()` detecta `ND` y `SA` a la vez, se descarta `ND` y se prioriza `SA`** — es decir, `"attribution - non derived work - non commercial - share alike"` se resuelve a `cc-by-nc-sa`, no se bloquea. El registro se importa con un warning tolerable (`field: "license"`) indicando qué se asumió, para que quede trazable y revisable en el informe de ejecución.

### Consecuencias

* Recursos que antes se bloqueaban (99 del ejemplo real) ahora se importan, con licencia `cc-by-nc-sa` (o `cc-by-sa` si además no llevaban `non commercial`) y un warning explícito.
* `LicenseNormalizationResult` gana un campo `ndSaConflictResolved: boolean` para que el llamante (`field-mapper.ts`) sepa cuándo emitir el warning, sin cambiar la firma de `matched`/`license`.
* El fixture de test `es_2025101012_9102834.json` (usado en `apps/cli/src/test-fixtures/legacy-procomun/`), que antes ejercitaba el camino bloqueante end-to-end, ahora ejercita el camino de resolución con warning — los tests de integración que lo usaban como "contenido `.elpx` garantizado no persistido" (deduplicación por hash) se migraron a contenido sintético generado en el propio test, porque ese fixture ahora sí se persiste en el mismo proceso de test (comparten una única BD PGlite).
* Esta regla es específica del importador legacy (`normalizeLicense()` solo se usa desde `field-mapper.ts`); no afecta a la validación de licencias en la creación manual de recursos, que sigue validando directamente contra `VALID_LICENSES` sin pasar por esta normalización de texto libre.

Validación: `bun test` completo del monorepo (808/808, +1 test nuevo) y `check-test-files.ts` sin incidencias.

## Actualización 2026-07-16 (3) — fuente única de verdad para tipos de recurso, y 10 equivalencias nuevas

Al revisar el informe de la importación real (826 pares), el usuario observó que los tipos de recurso sin equivalencia (248→281 tras el fix de licencia) no eran solo un problema del diccionario del importador: `resources.resourceType` es `varchar(100)` **sin enum en BD** (`packages/db/src/validation.ts`), y tres ficheros mantenían cada uno su propia lista informal de "tipos soportados", desincronizadas entre sí:

* `packages/db/src/legacy-import/resource-type-map.ts` (diccionario de equivalencias del importador) — no incluía `actividad-interactiva`.
* `apps/frontend/src/lib/resource-filters.ts` (opciones del filtro de búsqueda pública) — no incluía `guia-docente` ni `infografia`, pese a que sí se usan en datos reales (`seed-data.ts`).
* `packages/db/src/seed-data.ts` (datos de ejemplo) — usaba tipos que ni el importador ni el filtro público reconocían.

### Decisión

1. **Fuente única de verdad**: nuevo módulo `packages/db/src/resource-types.ts` (`RESOURCE_TYPES`, `RESOURCE_TYPE_VALUES`), exportado como `@procomun/db/resource-types`. `apps/frontend/src/lib/resource-filters.ts` deriva `RESOURCE_TYPE_OPTIONS` de esta lista en vez de mantener una copia a mano — un tipo nuevo añadido aquí se propaga automáticamente al filtro público.
2. **Nuevo tipo `mapa-conceptual`**: en vez de forzar los mapas conceptuales (46 recursos del ejemplo real) dentro de `infografia` (categoría existente más cercana), el usuario decidió que un mapa conceptual es una categoría propia — se añade a `RESOURCE_TYPES`.
3. **10 equivalencias nuevas en el diccionario del importador** (`resource-type-map.ts`), mapeo de negocio confirmado con el usuario tras revisar los valores de origen reales (español y término LOM en inglés, `educationalLearningResourceTypeStr`) de cada bucket sin equivalencia:

   | Valor de origen | → Tipo canónico |
   |---|---|
   | "Lección magistral" | `presentacion` |
   | "Juego didáctico" / *integrated media* | `actividad-interactiva` |
   | "Mapa conceptual" / *conceptual map* | `mapa-conceptual` |
   | "Cuestionario" / *self assessment* | `evaluacion` |
   | "Simulación" / *experiment* | `actividad-interactiva` |
   | "Problema abierto" | `ejercicio` |
   | "Aprendizaje basado en problemas" | `proyecto` |
   | "Texto narrativo" / *narrative text* | `documento` |
   | "Webquest" | `actividad-interactiva` |
   | "Presentación multimedia" | `presentacion` |

   Se indexan tanto por el texto español (`resourceType`) como, cuando corresponde a un término LOM estándar fiable, por su valor en inglés (`educationalLearningResourceTypeStr`), para cubrir mejor el resto del corpus real (~78.800 recursos), no solo la muestra de 826 analizada.

### Consecuencias
* Guardián de deriva: `resource-types.unit.test.ts` verifica que todo `resourceType` usado en `seed-data.ts` está en `RESOURCE_TYPE_VALUES`, para que las tres listas no puedan volver a desincronizarse sin que un test lo detecte.
* Sobre la muestra de 826 pares, los warnings de `resourceType` deberían bajar significativamente en la próxima ejecución (275 registros afectados por estos 10 valores).
* Esta es una unificación pragmática ("parche rápido"), no un rediseño del modelo de datos: `resourceType` sigue siendo texto libre sin validar en BD, y el sistema de taxonomías ya existente sigue desconectado de `resources` (riesgo ya anotado en la sección "Negativas / Riesgos" de esta ADR). Queda abierto un caso de investigación (`docs/casos/tipos-de-recurso/`) para decidir si `resourceType` debería convertirse en vocabulario controlado a medio plazo.

Validación: `bun test` completo del monorepo (824/824, +16 tests nuevos), `bunx @biomejs/biome check .` y `check-test-files.ts` sin incidencias; `apps/frontend` compila (`vite build`) con el nuevo import.

### Correcciones de la revisión del PR #274

El fix del tipado del diccionario (`RESOURCE_TYPE_DICTIONARY: Record<string, ResourceTypeValue>`, derivando `ResourceTypeValue` de `RESOURCE_TYPES as const`) se aplicó y fusionó directamente. Quedó un hallazgo [P2] sin resolver en el merge: `apps/frontend/src/islands/resources/resource-form-options.ts` (usado por los formularios de alta/edición) mantenía su propia lista con solo 10 de los 13 tipos reales, sin `guia-docente`, `infografia` ni el nuevo `mapa-conceptual`.

Al corregirlo se encontraron **dos sitios adicionales con el mismo problema, no cubiertos por el fix inicial de `resource-form-options.ts`**: `apps/frontend/src/pages/NuevoPage.tsx` y `apps/frontend/src/pages/EditarPage.tsx` (rutas reales `/nuevo` y `/editar`, registradas en `App.tsx`) tenían sus propios bloques `<option>` de `resourceType` escritos a mano directamente en el JSX, sin pasar por `resource-form-options.ts` en absoluto — cinco sitios en total mantenían alguna copia del vocabulario de tipos antes de esta ADR, no tres. En `EditarPage.tsx` el bug era además más grave que "no aparece la opción seleccionada": el `<select>` es no controlado (`ref={resourceTypeRef}`, `defaultValue={res.resourceType ?? "documento"}`); si `res.resourceType` no está entre las 10 opciones hardcodeadas, el navegador selecciona la primera (`documento`) sin avisar, y al guardar (`resourceTypeRef.current?.value`) se persiste ese valor — **editar cualquier otro campo de un recurso con `mapa-conceptual`, `guia-docente` o `infografia` le cambiaba silenciosamente el tipo a `documento`**.

Fix: los tres ficheros (`resource-form-options.ts`, `NuevoPage.tsx`, `EditarPage.tsx`) renderizan ahora `RESOURCE_TYPE_OPTIONS`/`RESOURCE_TYPES` vía `.map()`, sin ningún `<option>` escrito a mano. `ResourceFormIsland.tsx`/`ResourceEditorIsland.tsx` ya lo hacían correctamente y no necesitaron cambios.

Validación: `bun test` completo del monorepo (824/824), `bunx @biomejs/biome check .` y `check-test-files.ts` sin incidencias; `apps/frontend` compila (`vite build`).

## Actualización 2026-10-22 — el estado editorial sale de `published` (issue #447)

### Contexto
La actualización del 2026-07-10 dio por hecho que todo lo exportado del Procomún antiguo estaba publicado. No es así: el JSON trae el campo `published` y hay recursos con `published: 0` (p. ej. `es_2025100752_9110410`). El importador no lo leía, así que esos recursos quedaban en el catálogo público.

### Decisión revisada
Sustituye a la del 2026-07-10, con lo acordado en #447:

| `published` en el JSON | `editorialStatus` | Informe |
|---|---|---|
| `1` o `"1"` | `published` | — |
| `0` o `"0"` | `draft` | estado y valor recibido en el registro |
| ausente, nulo u otro valor | `draft` | además, warning `published: …` |

La regla vive en `resolveLegacyPublicationStatus` (`packages/db/src/legacy-import/publication-status.ts`). Cada registro `imported`/`would_import` del informe lleva `editorialStatus` y `sourcePublished`, y `totals.importedAsDraft` cuenta los que entran como borrador. Los borradores se localizan en Administración → Recursos (curator y admin ven todos los estados; el autor del recurso es el usuario de sistema).

### Corrección de lo ya importado
`import:legacy-procomun --fix-published --source-dir <ruta> [--dry-run] [--report-dir <ruta>]` relee los JSON de origen y, para cada `published` distinto de 1, pasa a `draft` el recurso importado (`unpublishUnreviewedLegacyResource`). Solo toca recursos `published` sin decisión editorial posterior: si tienen `assignedCuratorId`, `curatedAt` o `featuredAt`, se dejan como están y el informe los lista como `reviewed`. La misma condición va en el `UPDATE`, así que una revisión concurrente no se pisa. Repetirlo no cambia nada (`not_published`). Escribe `informe_correccion-publicados-<runId>.json`.

### Consecuencias
* El catálogo, la búsqueda y la descarga (`/uploads/:id/content`) ya filtraban por `published`; no cambian.
* La previsualización `/api/v1/elpx/<hash>/` sigue sin mirar el estado. El hash (SHA-256 del paquete) solo se obtiene por la ficha, que ya filtra; queda como riesgo abierto para un enlace guardado antes de despublicar.
* Tests: `publication-status.unit.test.ts`, `field-mapper.unit.test.ts`, `repository.unit.test.ts` y la integración de `import-legacy-procomun.integration.test.ts` (rojo sin el cambio: `Expected: "draft"`, `Received: "published"`).

## Actualización 2026-10-26 — la imagen `preview` se copia, no se enlaza (issue #409)

Desde #425 el importador guardaba en `resources.thumbnail_url` la URL de `preview` tal cual (`https://ode.educacion.es/INTEF/<id>/vistaPreviaAgrega.png`), y las tarjetas la cargaban directamente de ese host. Así dependíamos de que el servidor antiguo siguiera en pie y cada visita a un listado avisaba a un tercero.

* Durante la importación, la imagen se descarga y se guarda en `storageDir/thumbnails/<sha256>.<ext>`, servida en `/api/v1/thumbnails/<fichero>` con su tipo, `nosniff` y caché inmutable.
* Solo se descarga de `ode.educacion.es`, también al seguir redirecciones (como mucho 3), con un límite de 2 MB y 15 s. El tipo se decide por los primeros bytes (PNG, JPEG, GIF o WebP), no por la cabecera ni la extensión: un HTML o un SVG nunca se guarda como miniatura.
* Si no se puede copiar, el recurso entra sin miniatura y el informe lo avisa (`preview: no se copia la imagen …`). Nunca se guarda la URL remota.
* `import:legacy-procomun --copy-previews [--dry-run]` hace lo mismo con lo ya importado. Los fallos definitivos (otro host, no es imagen, 404, tamaño) retiran la miniatura. Los pasajeros (red, 5xx, 429) la dejan para repetir el comando. El informe guarda la URL de origen de cada recurso.

## Actualización 2026-10-26 — sin idioma por defecto (issue #473)

### Contexto

El importador ponía `"es"` a todo recurso sin idioma reconocible y, si faltaba `generalLanguageStr`, tomaba `educationalLanguageStr`. Ese campo es el «Idioma destinatario» (LOM 5.11, el del alumnado): un recurso en inglés para alumnado hispanohablante quedaba en español. El código `va` (valenciano), que el Procomún antiguo usa en unos 620 recursos, tampoco se reconocía y acababa en `"es"`.

### Decisión

* `resources.language` admite `null` (migración `0016_resource_language_nullable` y `setup.ts`).
* El idioma sale solo de `generalLanguageStr`. Si no hay un valor reconocible, el recurso entra sin idioma con un warning en el informe.
* `va` se normaliza a `ca` (en ISO 639 el valenciano es catalán; BCP 47 `ca-valencia`). `VALID_LANGUAGES` no cambia.
* La ficha oculta «Idioma» si está vacío y el editor muestra «Sin indicar» en vez de preseleccionar «Español».

### Corrección de lo ya importado

`import:legacy-procomun --fix-language --source-dir <ruta> [--dry-run]` relee los JSON y aplica el idioma de origen (o ninguno) a los recursos que siguen en `"es"` y cuyo `generalLanguageStr` no da `"es"`. Ese `"es"` solo pudo venir del valor por defecto o del «Idioma destinatario»; los recursos con otro idioma se respetan porque vino del origen o de una edición. No se distingue un `"es"` puesto a mano después de importar: también se corregiría.

### Consecuencias

* Sin idioma, los niveles ELE no se asignan (la regla exige `es`) y el recurso queda pendiente de revisión.
* Idiomas declarados fuera de `VALID_LANGUAGES` (`ar`, `la`, `zh`…) quedan sin idioma en lugar de en español.
* La búsqueda usa el diccionario `spanish` cuando el idioma es `null`, igual que antes.

## Actualización 2026-11-03 — cada recurso pasa a la cuenta de su autor (issue #456)

### Contexto
El importador dejaba `resources.created_by` vacío y la sesión de subida del paquete a nombre del usuario de sistema. El autor solo quedaba como texto (`author`, `otherAuthors`, `publisher`), así que el recurso no salía en «Mis recursos» ni en la ficha de autor (#487) y su autor no podía editarlo. El equipo del Procomún antiguo confirmó el 2026-11-02 que allí el identificador único de la cuenta es el correo, y que cada ODE, artículo e itinerario lo trae en `publicatorEmailStr`.

### Decisión
* `mapLegacyRecord` devuelve `publicatorEmail`: `publicatorEmailStr` sin espacios y en minúsculas (`normalizeLegacyPublicatorEmail`).
* `findLegacyAuthorAccount` busca la cuenta por `lower(user.email)` (índice `user_email_lower_unique`) y el recurso nace con `created_by` igual a esa cuenta. Es la columna que usan «Mis recursos», el panel del usuario, la ficha `/autor/<id>`, el feed del usuario y los permisos (`canManageResource`, `canManageResourceUpload`). Cada correo se busca una vez por ejecución.
* Las cuentas bloqueadas cuentan: sus recursos quedan asociados, como pidió el equipo del Procomún antiguo. Las dadas de baja no reciben nada y el usuario de sistema nunca se asigna.
* Sin cuenta, el recurso entra como hasta ahora (`created_by` vacío) y el informe lo lista en `authorsWithoutAccount` con `externalId`, `email` y `reason` (`no_email`, `no_account`, `deleted_account` o `unverified_account`). El lote no falla. Una cuenta con el correo sin verificar no recibe recursos: con `AUTH_REQUIRE_EMAIL_VERIFICATION=false` cualquiera podría registrarse antes con el correo de un autor antiguo y quedarse con ellos.
* Los campos de autoría en texto no cambian.
* `upload_sessions.owner_id` del paquete sigue siendo el usuario de sistema. Registra quién subió el fichero, no da permisos y solo cuenta para la cuota de subida (`UPLOAD_MAX_TOTAL_BYTES_PER_USER`), así que los paquetes legacy no gastan la cuota del autor. `elpx_projects` no tiene propietario.
* Reimportar es idempotente y enlaza: lo ya importado que sigue a nombre del sistema (`created_by` vacío o el usuario de sistema) pasa a la cuenta que exista ahora. Un creador real (por ejemplo, reasignado a mano) no se pisa nunca; la condición va en el propio `UPDATE` (`linkLegacyResourceAuthor`). No cambia `updated_at`.
* `import:legacy-procomun --link-authors --source-dir <ruta> [--dry-run] [--report-dir <ruta>]` enlaza lo ya importado sin reimportar. Solo lee los `.json`, no necesita los `.elpx`. Escribe `informe_enlace-autores-<runId>.json`: lo enlazado, lo que conserva otro creador y lo no importado van en `records`; lo ya enlazado solo se cuenta.
* El informe de la ingesta añade `createdBy` a cada `imported`/`would_import`, `authorLink` a cada `skipped_existing`, `totals.authorLinked`, `totals.authorWithoutAccount` y `authorsWithoutAccount`.

### Consecuencias
* El autor ve y gestiona sus recursos importados en cualquier estado, borradores incluidos: `canManageResource` deja al creador con rol `author` o superior gestionar lo suyo, y los borradores ajenos solo los ven su creador y el admin (#460). Es lo que pidió el equipo del Procomún antiguo. Hasta ahora los borradores legacy solo los veía el admin. Una cuenta `reader` ve sus borradores, pero no puede editarlos.
* La búsqueda del backoffice por nombre del creador (`user.name`) encuentra también los recursos legacy enlazados.
* Sin migración: `created_by` ya existía.
* Las cuentas las crea el importador de usuarios (#488). Lo más sencillo es importar antes los usuarios; si no, basta con `--link-authors` o con reimportar.
* Artículos (#446) e itinerarios (#432) usarán la misma búsqueda por correo.
* Tests: `publicator-email.unit.test.ts`, `field-mapper.unit.test.ts`, `repository/legacy-authors.unit.test.ts`, `import-legacy-procomun.unit.test.ts` e `import-legacy-procomun.integration.test.ts` (rojo sin el cambio: módulos y exportaciones inexistentes, `publicatorEmail` `undefined`).

## Actualización 2026-11-03 (2) — importación de artículos (issue #446)

### Contexto
El Procomún antiguo exporta sus artículos en el mismo formato que los ODE (`<id>.json` + `<id>.elpx`), con `"type": "POST"`. El importador los bloqueaba todos: su JSON no trae `rightsCopyrightAndOtherRestrictionsStr` y la licencia es obligatoria. Además, el tipo salía genérico, el autor quedaba vacío (solo traen `publicatorStr`) y la descripción recibía el HTML completo del artículo. El `.elpx` exportado declara CC BY-SA 4.0 en los cuatro ejemplos, pero es el valor por defecto del exportador, no la licencia del artículo.

### Decisión
Decidido en #446 por el equipo del Procomún antiguo (@jacoboAlcantara), y por @juanda para los artículos sin autor (2026-11-03):

* Los artículos entran por el mismo comando, `import:legacy-procomun`. `isLegacyArticle` los reconoce por `type` y `mapLegacyRecord` devuelve `kind: "article"`.
* **Licencia:** la de por defecto de la plataforma, `DEFAULT_LICENSE` (`cc-by`, la que preseleccionan los formularios de alta), con aviso `license` en el informe para poder listarlos. Si un artículo sí trae licencia, se trata como en un ODE. La licencia del `.elpx` no se usa.
* **Tipo:** `articulo` («Artículo»), nueva entrada de `RESOURCE_TYPES`, para todos. Es una entrada más del diccionario, así que la revisión de #419 puede cambiarla.
* **Autor:** la cuenta cuyo correo es `publicatorEmailStr` (#456) pasa a ser la creadora. `publicatorStr` queda como autor y editor en texto, como `publicatorNameStr` en los ODE.
* **Sin cuenta, sin correo o con la cuenta dada de baja:** el artículo **no se importa**. El informe lo registra como `skipped_without_author` con `externalId`, `email` y `reason`, y lo cuenta en `totals.skippedWithoutAuthor`. No es un error y el lote sigue. Los ODE sin cuenta no cambian: siguen entrando a nombre del sistema (#456).
* **Descripción:** `"Artículo relacionado con " + titleStr`.
* **Imágenes externas:** se conservan. El `.elpx` se procesa sin modificarlo.
* **Borradores:** `published: 0` entra como borrador de su autor (#447).
* **Contenido HTML:** el cuerpo (`descriptionStr`) no se guarda como HTML en ningún sitio. Se pasa a texto plano con `extractTextFromHtml`, la misma limpieza que un `.html` subido, y va a `resources.extracted_text` para la búsqueda. El artículo se ve desde su `.elpx`, servido con origen opaco y CSP (ADR-0026).

### Consecuencias
* El informe añade `kind: "article"` a los registros de artículos y `totals.articles` y `totals.skippedWithoutAuthor`.
* Sin migración: los tipos de recurso viven en código (`packages/db/src/resource-types.ts`) y «Artículo» aparece en filtros y formularios.
* Reimportar es idempotente: lo importado se omite y se enlaza como un ODE, y un artículo omitido entra cuando su cuenta exista. Por eso conviene importar antes los usuarios (#488).
* Supuesto sin confirmar: los `id` de artículos y ODE no coinciden entre sí. En el origen parecen vivir en el mismo índice, distinguidos por `type`. Si alguno coincidiera, el segundo se omitiría como ya importado.
* Riesgo de licencia: uno de los ejemplos (`vr5DpZYBAcddN1-H2qPg`) dice en su texto «licensed under CC BY-SA 4.0», y se importa como `cc-by`. El aviso `license` del informe permite localizar todos los artículos con la licencia asignada por defecto.
* Las miniaturas de los artículos llegan como ruta relativa del Drupal antiguo y se descartan con aviso, porque `legacy-preview-image.ts` solo descarga de `ode.educacion.es`. Queda pendiente.
* Tests: `article.unit.test.ts`, `field-mapper.unit.test.ts`, `repository.unit.test.ts`, `extract.unit.test.ts`, `import-legacy-procomun.unit.test.ts` e `import-legacy-procomun.integration.test.ts`. En rojo sin el cambio: `blocked` con `Licencia no reconocida: ""`, y los artículos sin cuenta se importaban a nombre del sistema.
