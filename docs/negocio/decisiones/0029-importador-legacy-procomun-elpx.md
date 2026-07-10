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
