# ADR-0043 Catálogo de categorización educativa en código

* Estado: Propuesto
* Fecha: 2026-10-14
* Agentes Implicados: [@.agents/skills/metadatos-y-curacion, @.agents/skills/arquitectura-solucion, @.agents/skills/interoperabilidad-educativa]

## Contexto y Problema

La issue #380 pide clasificar los recursos por etapa, programa o ámbito educativo en dos niveles (categoría y, a veces, ciclo, tramo o nivel) y filtrar el catálogo por esa clasificación. La lista es cerrada: 12 categorías y sus opciones, definidas por Producto.

Ya existen dos sitios donde podría vivir:

* `resource_levels`: texto libre por recurso. El importador guarda ahí el `learningContext` del Procomún antiguo (ADR-0029).
* `taxonomies`: tabla jerárquica editable desde el backoffice. Sigue sin conectarse a `resources` (riesgo anotado en ADR-0029).

## Opciones Consideradas

* Normalizar `resource_levels` contra la lista nueva.
* Cargar las categorías en `taxonomies` y relacionarlas con `resources`.
* Catálogo cerrado en código con ids estables y una tabla de asignaciones `resource_educational_areas`.

## Decisión

Catálogo en código (`packages/db/src/educational-areas.ts`) con ids estables y tabla `resource_educational_areas` (`resource_id`, `category_id`, `option_id` nullable).

* La lista es cerrada y la valida el servidor: un catálogo editable en `taxonomies` permitiría crear o borrar categorías sin migrar los datos ni revisar formulario, ficha, buscador e importador. Cambiar el catálogo es un cambio de código revisado.
* Los ids no cambian una vez publicados. Si cambia una etiqueta, el id se mantiene; si desaparece una opción, se migra con una migración de datos.
* Formulario, ficha, buscador, API y la correspondencia del importador (#383) usan el mismo módulo, sin consultas extra.
* `resource_levels` se queda como dato de origen: conserva el texto antiguo para trazabilidad y para recalcular la correspondencia, pero no es la clasificación del recurso ni se filtra por él.
* LOM-ES: la correspondencia con el contexto educativo (5.6) y la clasificación por nivel educativo (9) se hará en el exportador, traduciendo cada id a su término. Al ser ids estables, esa tabla de correspondencia no depende de las etiquetas.

## Consecuencias

### Positivas
* Una sola fuente de ids y etiquetas para todas las capas.
* La base de datos impide duplicados con índices únicos parciales y el filtro por categoría es un `EXISTS` indexado.
* Restaurar una versión restaura también la clasificación (va en el snapshot).

### Negativas / Riesgos
* Cambiar el catálogo exige desplegar código.
* Las etiquetas solo están en castellano. Traducirlas está pendiente de decisión en #380.
* `taxonomies` sigue sin uso para recursos. Si algún día se conecta, habrá que decidir si absorbe este catálogo.
* Mientras la ficha muestre también «Niveles educativos», conviven el texto antiguo y la clasificación nueva (pendiente de decisión en #380).

## Notas de Implementación

* Migración `0009_educational_areas` y el mismo DDL en `setup.ts`. El esquema Drizzle declara los tres índices.
* El seed de demo crea la categoría cuando el nivel de demo es un id del catálogo.
* La correspondencia de los textos antiguos al catálogo es la issue #383.
* La correspondencia con LOM-ES queda para cuando se aborde la exportación.
