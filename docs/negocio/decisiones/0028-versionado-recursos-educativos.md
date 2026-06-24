# ADR-0028 Versionado de recursos educativos

* Estado: Propuesto
* Fecha: 2026-06-24
* Agentes Implicados: [@.agents/skills/evaluacion-tecnologica, @.agents/skills/metadatos-y-curacion, @.agents/skills/backend-api-servicios, @.agents/skills/interoperabilidad-educativa, @.agents/skills/seguridad-privacidad-legal, @.agents/skills/documentacion-y-roadmap]

## Contexto y Problema

Procomun permite crear, editar, revisar, publicar y exportar recursos educativos, incluyendo metadatos descriptivos, adjuntos y proyectos `.elpx`. El modelo actual conserva campos de sistema como `createdAt`, `updatedAt`, `deletedAt` y `editorialStatus`, y la estrategia ENS exige trazabilidad de acciones críticas, pero no existe una decisión explícita sobre versionado funcional de recursos.

El versionado debe resolver un problema público y educativo: garantizar que un docente pueda reutilizar un recurso publicado sabiendo qué contenido está consultando, cuándo cambió, quién lo cambió, qué versión fue aprobada editorialmente y si puede recuperarse una versión anterior ante errores, retirada de licencias o incidencias pedagógicas.

La decisión afecta a:

* Metadatos: cambios en título, descripción, licencia, nivel educativo, autoría, idioma, palabras clave y campos semiestructurados.
* Contenido: adjuntos, proyectos `.elpx`, exportaciones derivadas y posibles recursos externos.
* Flujo editorial: borradores, revisión, publicación, archivo, restauración y publicación directa por usuarios de confianza.
* Interoperabilidad: OAI-PMH, feeds, APIs públicas, exportaciones LMS y enlaces estables.
* Moderación y seguridad: auditoría, rollback, evidencia de cambios, retirada de versiones problemáticas y protección frente a sobrescritura maliciosa.

Preguntas que debe resolver la decisión:

* ¿La versión pública debe ser inmutable una vez publicada?
* ¿Qué cambios generan una versión mayor, menor o solo una revisión interna?
* ¿Se versionan solo metadatos, solo binarios, o el agregado completo del recurso?
* ¿Cómo se relacionan versiones editoriales con estados (`draft`, `review`, `published`, `archived`)?
* ¿Qué identificadores públicos serán estables: slug del recurso, número de versión, URL canónica o DOI/URN futuro?
* ¿Qué necesita la búsqueda para indexar la versión vigente sin perder trazabilidad histórica?
* ¿Qué modelo minimiza lock-in técnico y coste operativo?

## Opciones Consideradas

* Opción A: Sin versionado funcional, solo auditoría de cambios.
* Opción B: Tabla relacional `resource_versions` con snapshots inmutables.
* Opción C: Event sourcing de cambios de recurso.
* Opción D: Versionado con Git como backend de historial.
* Opción E: Versionado del binario mediante object storage con versioning y metadatos en PostgreSQL.
* Opción F: Modelo híbrido PostgreSQL snapshots + object storage versionado.

### Opción A: Sin versionado funcional, solo auditoría de cambios

Mantener el modelo actual y añadir, si procede, una tabla de auditoría genérica con eventos de modificación.

**Pros**

* Menor coste inicial.
* Encaja con la necesidad ENS de saber quién modificó información.
* No requiere rediseñar la API pública ni el editor.
* Útil para trazabilidad administrativa básica.

**Contras**

* No permite reconstruir con garantías una versión publicada.
* No ofrece rollback funcional seguro.
* No resuelve enlaces estables a una versión concreta.
* Dificulta comparar cambios pedagógicos, licencias o adjuntos.
* Es insuficiente para interoperabilidad avanzada y preservación.

### Opción B: Tabla relacional `resource_versions` con snapshots inmutables

Crear una tabla `resource_versions` que almacene un snapshot completo de cada versión relevante del recurso: metadatos normalizados, campos semiestructurados, estado editorial, referencias a adjuntos, autor del cambio, motivo, número de versión y marca temporal. La tabla `resources` mantiene la identidad canónica y punteros como `currentVersionId` y `publishedVersionId`.

**Pros**

* Modelo explícito, consultable y transaccional en PostgreSQL.
* Encaja con Drizzle, TypeScript strict, Bun y la arquitectura actual.
* Permite publicar una versión inmutable mientras el borrador evoluciona.
* Facilita rollback, diff a nivel de campos y auditoría editorial.
* Permite indexar solo la versión publicada vigente en búsqueda.
* Bajo lock-in: SQL estándar y JSONB para snapshots semiestructurados.

**Contras**

* Incrementa almacenamiento y complejidad de repositorios.
* Requiere definir cuándo se crea una versión: guardado, envío a revisión, publicación o cambio significativo.
* Los adjuntos grandes no deben duplicarse en base de datos; requieren referencias estables.
* Necesita migración de datos actuales a versión inicial.

### Opción C: Event sourcing de cambios de recurso

Registrar todos los cambios como eventos append-only (`ResourceCreated`, `MetadataChanged`, `FileAttached`, `SubmittedForReview`, `Published`, etc.) y reconstruir el estado del recurso proyectando eventos.

**Pros**

* Trazabilidad máxima y reconstrucción temporal precisa.
* Muy potente para auditoría, moderación y análisis de flujo editorial.
* Permite derivar proyecciones para búsqueda, API pública y métricas.
* Puede modelar bien acciones editoriales y motivos de cambio.

**Contras**

* Alta complejidad para el estado actual del proyecto.
* Requiere disciplina fuerte de diseño de eventos, migración de eventos y proyecciones.
* Mayor coste de onboarding y riesgo de bugs en reconstrucción.
* Puede ser excesivo si la necesidad principal es snapshot de versiones publicadas.
* Introduce acoplamiento conceptual fuerte al patrón event-sourced.

### Opción D: Versionado con Git como backend de historial

Representar cada recurso como un conjunto de ficheros versionables en un repositorio Git: metadatos en JSON/YAML, manifiesto de adjuntos, quizá contenido `.elpx` o punteros a binarios. Cada publicación o revisión se materializa como commit o tag. PostgreSQL conservaría índices operativos, permisos y datos de consulta.

**Pros**

* Git ofrece historial inmutable, diffs, commits, tags, ramas y rollback maduro.
* Muy bueno para comparar metadatos textuales y manifiestos.
* Bajo coste conceptual para equipos técnicos acostumbrados a revisión por cambios.
* Puede facilitar exportación, preservación y trazabilidad externa.
* Evita diseñar desde cero ciertas capacidades de historial.

**Contras**

* Git no es una base de datos transaccional multiusuario para una plataforma web.
* Gestionar binarios grandes (`.elpx`, vídeos, PDFs) requiere Git LFS u object storage, añadiendo operación y lock-in parcial.
* La autorización, concurrencia y consistencia con PostgreSQL se complican.
* Las búsquedas, facetas y APIs seguirían necesitando proyecciones en base de datos.
* Puede degradar rendimiento con muchos recursos, adjuntos o commits frecuentes.
* Aumenta superficie operativa: repositorios internos, locking, GC, backups, corrupción, recuperación y observabilidad.
* Puede exponer accidentalmente datos personales o contenido retirado si no se diseña una política estricta de repositorios privados, purgado y retención.

### Opción E: Versionado del binario mediante object storage con versioning y metadatos en PostgreSQL

Usar capacidades nativas de versionado del almacenamiento de objetos para adjuntos y `.elpx`, manteniendo en PostgreSQL la versión lógica del recurso y referencias a `objectKey` + `versionId`.

**Pros**

* Adecuado para binarios grandes.
* Reduce duplicación de blobs y evita meter contenido pesado en PostgreSQL.
* Encaja con almacenamiento S3-compatible y políticas de retención.
* Permite recuperar binarios anteriores sin diseñar un sistema propio de blobs.

**Contras**

* No versiona por sí solo los metadatos ni el agregado educativo completo.
* Introduce dependencia del proveedor o de la semántica S3-compatible elegida.
* Complica desarrollo local y preview si no se abstrae bien.
* El rollback requiere coordinar versión de metadatos y versión de objeto.

### Opción F: Modelo híbrido PostgreSQL snapshots + object storage versionado

Combinar snapshots inmutables en PostgreSQL para la versión lógica del recurso con referencias estables a versiones de objetos externos para adjuntos y `.elpx`. La identidad del recurso vive en `resources`; cada versión publicada o revisable vive en `resource_versions`; los binarios viven en storage con `objectVersionId` o hash de contenido.

**Pros**

* Cubre el agregado completo: metadatos, estado editorial y binarios.
* Mantiene PostgreSQL como fuente transaccional del dominio.
* Usa object storage para lo que hace bien: blobs grandes, retención y recuperación.
* Permite una URL pública canónica del recurso y URLs opcionales por versión.
* Facilita indexar solo `publishedVersionId` y conservar histórico.
* Reduce lock-in frente a Git como backend operativo.

**Contras**

* Es más complejo que snapshots solo en PostgreSQL.
* Requiere definir abstracción de storage para desarrollo local, test y producción.
* Las garantías de consistencia entre DB y storage deben diseñarse con cuidado.
* Necesita jobs de limpieza, retención y verificación de integridad.

## Decisión

Decisión pendiente. Se abre esta ADR como estudio formal de versionado de recursos educativos.

La hipótesis inicial a validar es adoptar un modelo híbrido orientado a snapshots:

* `resources` como identidad canónica y datos operativos mínimos.
* `resource_versions` como snapshot inmutable de cada versión editorial significativa.
* `publishedVersionId` para separar la versión pública estable del borrador en edición.
* Adjuntos y `.elpx` referenciados por hash, `objectKey` y, si existe, `objectVersionId`.
* Auditoría de acciones editoriales separada del snapshot funcional.

Git queda explícitamente incluido como alternativa a valorar, pero no debe adoptarse sin una prueba de concepto que demuestre concurrencia, rendimiento, autorización, recuperación y operación con binarios reales.

## Consecuencias

### Positivas

* La plataforma podría garantizar qué versión exacta de un recurso fue publicada, exportada o indexada.
* Mejora la confianza docente: cambios pedagógicos, licencias y adjuntos quedan trazables.
* Facilita rollback editorial y corrección de publicaciones defectuosas.
* Mejora interoperabilidad: APIs y feeds pueden exponer `version`, `publishedAt`, `isLatest` y enlaces canónicos.
* Permite separar edición en curso de versión pública consumida por usuarios y LMS.
* Alinea metadatos, búsqueda, moderación y ENS alrededor de un historial verificable.

### Negativas / Riesgos

* Aumenta el modelo de datos y la complejidad de servicios.
* Puede incrementar almacenamiento si los snapshots o adjuntos se duplican sin deduplicación.
* Requiere UX editorial clara para explicar borrador, revisión, publicación y versión vigente.
* Obliga a definir políticas de retención: versiones retiradas, contenido ilícito, datos personales y licencias revocadas.
* Si se elige Git, existe riesgo de usar una herramienta excelente para código como base operativa inadecuada para una plataforma transaccional.
* Si se elige object storage versionado, habrá que controlar lock-in y paridad local/test.

## Notas de Implementación

Siguientes pasos antes de aceptar una decisión:

1. Definir requisitos funcionales mínimos:
   * Versiones visibles para docentes.
   * Versiones internas para edición/revisión.
   * Rollback permitido solo para roles autorizados.
   * Conservación de versiones retiradas según seguridad/legal.
2. Proponer esquema inicial:
   * `resources(id, slug, currentDraftVersionId, publishedVersionId, createdBy, createdAt, updatedAt, deletedAt)`.
   * `resource_versions(id, resourceId, versionNumber, status, snapshotJson, changeSummary, createdBy, reviewedBy, publishedAt, createdAt)`.
   * `resource_version_assets(id, versionId, assetId, role, objectKey, objectVersionId, sha256, mimeType, sizeBytes)`.
3. Definir reglas de creación de versión:
   * Crear versión inicial al crear recurso.
   * Crear nueva versión al enviar a revisión o publicar cambios significativos.
   * No crear versión nueva por autoguardados menores si no cambian la versión editorial.
4. Diseñar endpoints candidatos:
   * `GET /api/v1/resources/:slug` devuelve solo la versión publicada vigente.
   * `GET /api/v1/resources/:slug/versions/:version` devuelve versión concreta si es pública.
   * `GET /api/admin/resources/:id/versions` lista historial autorizado.
   * `POST /api/admin/resources/:id/versions/:version/restore` crea nuevo borrador desde una versión previa.
5. Evaluar impacto en búsqueda:
   * Indexar exclusivamente `publishedVersionId`.
   * Excluir versiones archivadas o retiradas.
   * Reindexar al publicar o retirar una versión.
6. Evaluar impacto en interoperabilidad:
   * Exponer versión en feeds Atom/RSS y APIs públicas.
   * Preparar compatibilidad futura con OAI-PMH y metadatos LRMI/Dublin Core.
7. Evaluar Git con prueba de concepto acotada:
   * 1.000 recursos con metadatos JSON y adjuntos simulados.
   * Commits concurrentes desde API.
   * Restauración de versión.
   * Medición de latencia, tamaño de repo, backups y fallo/recovery.
8. Registrar una ADR final o actualizar esta ADR a `Aceptado` cuando exista evidencia suficiente.
