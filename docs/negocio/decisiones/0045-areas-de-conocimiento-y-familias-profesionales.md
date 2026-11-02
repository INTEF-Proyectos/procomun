# ADR-0045 Áreas de conocimiento en tabla gestionada y familias profesionales en código

* Estado: Propuesto
* Fecha: 2026-10-26
* Agentes Implicados: [@.agents/skills/metadatos-y-curacion, @.agents/skills/arquitectura-solucion, @.agents/skills/busqueda-y-descubrimiento]

## Contexto y Problema

La issue #448 pide sustituir las materias en texto libre (`resource_subjects`, `knowledgeArea` del Procomún antiguo) por un catálogo controlado de áreas de conocimiento, agrupadas en 9 bloques, y añadir las familias profesionales de FP. Producto cerró el 23/10:

* 56 áreas iniciales (las 55 de la issue más Química), solo en castellano.
* Como máximo 3 áreas por recurso.
* Los 9 bloques son fijos. Administración y curator crean, editan, mueven de bloque y desactivan áreas, pero no crean bloques.
* Las familias profesionales son la lista oficial cerrada; se actualizan con un cambio de código.
* Un área usada no se borra: se desactiva, deja de ofrecerse y conserva sus asociaciones.
* Los términos del catálogo de palabras clave (#384, ADR-0042) que pasan a ser áreas se retiran para nuevas selecciones y conservan sus asociaciones históricas.

La implementación va en tres PR: (1) catálogos, modelo de datos, permisos y panel; (2) formularios, ficha y filtros; (3) migración, correspondencias y curación. Esta ADR cubre las decisiones del primero.

## Opciones Consideradas

* Reutilizar `taxonomies` (CRUD genérico de categorías): solo admin edita, permite borrar y no tiene estado activo ni bloque.
* Reutilizar `tags` con un tipo nuevo, como las palabras clave: mezclaría disciplinas y subtemas en la misma tabla y en el mismo filtro.
* Catálogo cerrado en código, como la categorización educativa (ADR-0043): no permite que curator cree o edite áreas.
* Tabla propia `knowledge_areas` con bloques y familias en código.

## Decisión

Tabla propia `knowledge_areas` (id estable, denominación, descripción, bloque, posición, `active`), con relación `resource_knowledge_areas`. Los bloques (`KNOWLEDGE_AREA_BLOCKS`) y las familias profesionales (`PROFESSIONAL_FAMILIES`) son listas cerradas en `packages/db/src/knowledge-areas.ts`; la relación `resource_professional_families` guarda solo el id de la familia.

* **Id estable:** los iniciales son slugs fijos (`quimica`, `ele`…); los nuevos salen de la denominación al crearlos y no cambian al renombrar o mover de bloque.
* **Duplicados:** índice único sobre la denominación sin mayúsculas ni tildes, también frente a áreas inactivas. La aplicación lo comprueba antes y el índice cubre dos altas simultáneas.
* **Sin borrado:** la API no expone DELETE y la clave foránea de `resource_knowledge_areas` impide borrar un área con recursos.
* **Inactivas:** no se ofrecen; un recurso que ya tiene un área inactiva puede volver a guardarla, uno nuevo no.
* **Familias:** solo se admiten si el recurso está clasificado en Formación Profesional (`resource_educational_areas`, ADR-0043).
* **Permisos:** `/api/admin/knowledge-areas` exige curator+ en el router y en `admin/index.ts`, como el resto del backoffice.
* **Palabras clave retiradas:** columna `tags.retired_at`. Un término retirado no sale en la búsqueda del catálogo ni se puede añadir a un recurso; los que ya lo tienen lo conservan. El comando `catalog:area-keywords` cruza los catálogos: retira por defecto las de denominación idéntica a un área, lista las parecidas para revisión (`KEYWORD_AREA_REVIEW_CANDIDATES`) y deja las que no tienen área equivalente. Sin `--apply` es una prueba en seco.

## Consecuencias

### Positivas
* Curator mantiene el catálogo sin despliegues y sin tocar código.
* Renombrar, mover o desactivar no pierde asociaciones.
* Disciplina (área) y subtema (palabra clave) quedan separados, con un filtro fiable por área.
* La retirada de palabras clave es reversible (basta limpiar `retired_at`) y no borra datos.

### Negativas / Riesgos
* Tres catálogos parecidos con mecanismos distintos (categorización en código, áreas en tabla, palabras clave en `tags`).
* La tabla de candidatos a revisión es una decisión editorial escrita en código; se usa solo para el informe, nunca se aplica sin `--include`.
* Hasta el PR 2, las áreas no se pueden elegir en el formulario ni se ven en la ficha; hasta el PR 3, el fondo importado no tiene áreas.

## Notas de Implementación

* Migración `0014_knowledge_areas` (se salta 0012 y 0013, reservadas por PR abiertos) y bloque equivalente en `setup.ts`. Un test comprueba que el sembrado coincide.
* Panel «Áreas de conocimiento» en Administrar (curator+).
* PR 2: campo con búsqueda y autocompletado agrupado por bloques, familia profesional al elegir FP (limpiando las familias si se quita FP), ficha, filtros y obligatoriedad de al menos un área para salir de borrador.
* PR 3: tabla de correspondencias de `knowledgeArea`, informe, listado de curación y registro de quién resuelve.
