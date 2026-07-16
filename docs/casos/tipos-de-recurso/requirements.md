# Caso — Vocabulario de tipos de recurso (`resourceType`)

* Fecha: 2026-07-16
* Estado: Abierto (investigación pendiente, sin implementación)
* Relacionado: [ADR-0029](../../negocio/decisiones/0029-importador-legacy-procomun-elpx.md), actualización 2026-07-16 (3)
* Origen: observación del usuario al revisar el informe de una importación real (826 pares) — "hay un cierto descontrol y lío con los tipos de recursos en procomún"

## Problema público / educativo

`resources.resourceType` es un `varchar(100) NOT NULL` **sin enum ni vocabulario controlado** en base de datos (`packages/db/src/validation.ts` solo exige que no esté vacío). Lo que actúa como "tipos admitidos" son listas informales mantenidas a mano en varios sitios del código, sin ninguna garantía de que coincidan entre sí. Como parche inmediato (ver ADR-0029, actualización 2026-07-16 (3)) se unificaron en una única fuente de verdad (`packages/db/src/resource-types.ts`), pero eso resuelve la *desincronización*, no la pregunta de fondo: **¿es este el modelo de datos correcto para un catálogo de recursos educativos que aspira a interoperabilidad?**

Un vocabulario de tipos de recurso poco fiable degrada directamente la capacidad de descubrimiento (facetado/filtrado por tipo) y la calidad del metadato expuesto a terceros (interoperabilidad LOM/OAI-PMH, si llega a implementarse).

## Contexto — qué existe hoy

* **BD**: `resources.resourceType` es texto libre, sin `CHECK`, sin tabla de referencia.
* **`packages/db/src/resource-types.ts`** (nuevo, parche 2026-07-16): lista fija en código (`RESOURCE_TYPES`), 13 valores, usada por:
  - `apps/frontend/src/lib/resource-filters.ts` (opciones del filtro de búsqueda pública).
  - `packages/db/src/legacy-import/resource-type-map.ts` (diccionario de equivalencias del importador legacy, LOM-ES/inglés → vocabulario de `procomun-ng`).
  - Validada (test) contra `packages/db/src/seed-data.ts`, pero **no** contra la BD real ni contra recursos creados manualmente vía `POST /api/admin/resources` — esa vía sigue aceptando cualquier string no vacío.
* **Sistema de taxonomías ya existente pero desconectado**: `taxonomies` (BD) no tiene relación con `resources` hoy (riesgo ya anotado en ADR-0029, sección "Negativas / Riesgos" de la decisión original). No se ha investigado si `resourceType` debería vivir ahí en vez de en una constante de código.
* **Estándar de origen**: los JSON legacy traen `resourceType` (texto libre en español/LOM-ES) y `educationalLearningResourceTypeStr` (vocabulario LOM/IEEE 1484.12.1 "Learning Resource Type" en inglés, más controlado). No se ha evaluado si `procomun-ng` debería adoptar directamente ese vocabulario LOM en vez de uno informal propio.

## Preguntas a resolver (antes de diseñar la solución)

1. **¿Vocabulario controlado o texto libre con sugerencias?** Un enum/tabla de referencia impide valores nuevos no revisados, pero también bloquea la creación manual de un recurso con un tipo legítimo no previsto. ¿Se necesita un mecanismo de alta editorial para tipos nuevos?
2. **¿Alinear con LOM/IEEE 1484.12.1 (Learning Resource Type) o mantener un vocabulario informal en español?** Afecta directamente a la interoperabilidad futura (exportación LOM/OAI-PMH) y a qué tan reconocible es el catálogo para sistemas educativos externos.
3. **¿Conectar con el sistema de `taxonomies` ya existente en BD, o mantenerlo como constante de código?** Una tabla de referencia permite gestión editorial sin desplegar código; una constante es más simple pero requiere un cambio de código (y su propio ciclo de PR/revisión) para cada tipo nuevo.
4. **¿Migración de datos existentes?** Los recursos ya importados (ver ADR-0029) usan el vocabulario informal actual; cualquier cambio de esquema necesita un plan de migración/backfill, no solo una migración de esquema en vacío.
5. **¿Validación en la creación/edición manual de recursos?** Hoy `POST /api/admin/resources` no valida `resourceType` contra ninguna lista — ¿debería, y con qué mensaje de error si no está en el vocabulario?
6. **¿Cómo se decide qué tipos existen?** Hoy es una decisión ad-hoc (ver el mapeo de 10 valores confirmado con el usuario en la actualización 2026-07-16 (3) de ADR-0029) — ¿debería este catálogo tener dueño editorial explícito y un proceso de alta/baja documentado, en vez de añadirse por PR cada vez que aparece un caso nuevo?

## Preguntas obligatorias (AGENTS.md)

1. **¿Qué problema público/educativo resuelve?** Un catálogo con tipos de recurso fiables mejora el descubrimiento (filtros que realmente cubren lo que hay) y la calidad del metadato expuesto.
2. **¿Qué usuario principal se beneficia?** El usuario final que filtra por tipo de recurso en la búsqueda pública; el equipo de curación editorial, que necesita categorías con las que trabajar de forma consistente.
3. **¿Qué datos mínimos necesita el recurso?** Sin cambios todavía — pendiente de la decisión de esquema (pregunta 1/3 de arriba).
4. **¿Qué tecnología resuelve esta capa de forma óptima?** Por decidir: constante de código vs. tabla de BD vs. adopción de vocabulario LOM externo.
5. **¿Qué parte requiere desarrollo propio?** Por decidir tras las preguntas anteriores.
6. **¿Qué impacto tiene en búsqueda, metadatos y moderación?** Directo en facetado/filtrado de búsqueda; indirecto en calidad de metadato para interoperabilidad futura.
7. **¿Cómo se valida que mejora el descubrimiento y la reutilización?** Por definir junto con QA — posiblemente comparando cobertura del vocabulario frente al corpus real (~78.800 recursos legacy) antes/después.
8. **¿Qué riesgo de lock-in técnico o de modelo introduce?** Adoptar LOM íntegro podría acoplar el modelo de datos a un estándar externo poco usado fuera del ámbito educativo institucional; mantener vocabulario propio arriesga baja interoperabilidad. Es justo la decisión que este caso debe resolver.

## Estado

Sin resolver. No se ha implementado nada de este documento — es la investigación previa acordada con el usuario junto al parche pragmático ya aplicado (ADR-0029, actualización 2026-07-16 (3)). Siguiente paso: sesión de decisión con roles de Metadatos y Curación + Arquitectura de Solución (`@.agents/skills/metadatos-y-curacion`, `@.agents/skills/arquitectura-solucion`) para responder las preguntas de arriba y producir un `design.md` con la opción elegida.
