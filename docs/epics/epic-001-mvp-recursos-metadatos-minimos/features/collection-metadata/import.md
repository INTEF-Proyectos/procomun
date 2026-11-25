# Importación de metadatos de itinerarios (#615)

El importador resuelve las etiquetas contra el catálogo activo con las mismas reglas que los recursos. Normaliza los nombres de áreas y resuelve la denominación histórica «Tecnologías» a la entrada vigente «Tecnología». Usa la tabla de correspondencias de recursos para el contexto educativo y añade la descripción educativa al texto de la colección cuando contiene información.

El informe cuenta términos sin correspondencia, ambiguos y selecciones que superan los límites. No vuelca los valores de origen. La reimportación conserva las asociaciones existentes, evita duplicados y preserva las selecciones educativas ya editadas.

## Revisión de la PR #628 — 2026-11-24 (#615)

**Reimportación y ediciones manuales.** La colección guarda en `collections.legacy_imported_metadata` (migración `0036`) qué áreas y palabras clave le ofreció ya el importador y si le ofreció la clasificación educativa. Al reimportar solo se añade lo que el origen trae por primera vez: un valor ya ofrecido que no esté en la colección se quitó a mano y no vuelve. Lo pendiente de migrar sigue entrando, por ejemplo una etiqueta que el catálogo resuelve más tarde. Si los valores nuevos no caben en el máximo del campo no se apuntan como ofrecidos, para reintentarlo en la siguiente pasada.

Se descartó marcar por campo las ediciones manuales: obligaría a tocar todos los caminos que escriben metadatos (edición, fusión de palabras clave) y no distingue un valor retirado de uno nuevo. Apuntar lo ofrecido solo afecta al importador.

**Etiquetas largas.** `labelsStr` se separa por comas y cada etiqueta se resuelve por su cuenta contra el catálogo, sin el tope de 1000 caracteres del texto de palabras clave de los recursos. Una etiqueta desmesurada cuenta en `metadataIssues.labelsStr.unmatched` y no descarta a las siguientes. El único límite es el número de términos catalogados.
