# Metadatos técnicos de colecciones (#611)

El profesorado necesita saber para qué ámbito se ha organizado una colección antes de abrir sus recursos. La clasificación pertenece a la colección y se puede curar desde su edición. Una colección importada sigue las mismas reglas que una creada en Procomún.

| Campo | Fuente | Cardinalidad |
|---|---|---|
| Idioma | Códigos admitidos en recursos | Opcional, uno |
| Palabras clave | Identificadores del catálogo de palabras clave | Opcional, hasta cinco |
| Áreas de conocimiento | Identificadores del catálogo de áreas | Opcional, hasta tres |
| Etapa, programa o ámbito educativo | Pares de categoría y opción del catálogo de clasificación educativa | Opcional, con las reglas vigentes de recursos |

El idioma se guarda en la colección. Las palabras clave y áreas se relacionan por identificador con sus tablas de catálogo. La clasificación educativa conserva los pares canónicos ya usados por los recursos. La ficha pública resuelve nombres con esos catálogos y omite los campos vacíos. Una futura exportación puede usar los mismos identificadores y códigos que la exportación de recursos.

La edición usa los controles de clasificación ya disponibles y se autoriza con la regla de gestión de colecciones. La API valida ids, límites y pares de categoría y opción antes de persistir. Guardar solo el título conserva la clasificación previa. Editar la selección puede mantener términos retirados que ya pertenecían a la colección.

## Validación

- Una colección existente parte con los metadatos vacíos y se puede seguir editando.
- Editar una colección propia guarda y recupera los cuatro campos con identificadores válidos.
- Un id desconocido o un par inválido se rechaza sin cambios parciales.
- Una colección publicada muestra las etiquetas del catálogo en la ficha pública.
- La ficha sigue ocultando las colecciones que no están publicadas.

El formulario de alta se sigue en #614, los filtros en #612 y la correspondencia desde el JSON legado en #615. Los tres dependen del mismo modelo.

## 2026-11-21 · Alta de colecciones (#614)

El formulario de alta usa los mismos controles que la edición. Se valida la selección contra los catálogos al crear la colección. Si falla, la transacción revierte la colección y sus asociaciones para que la persona pueda corregir y reenviar el formulario.
