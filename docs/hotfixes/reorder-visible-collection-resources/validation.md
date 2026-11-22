# Reordenación de recursos visibles en colecciones (#617)

Cuando una colección contiene un borrador ajeno entre dos recursos visibles, bajar el primero debe intercambiar únicamente las posiciones de los dos recursos visibles. La operación de reordenación usa el mismo filtro que el listado y guarda el intercambio en una transacción.

La prueba de la API comprueba el orden que recibe el editor, la posición intacta del borrador y el rechazo de una petición para mover el borrador ajeno. Antes de la corrección, la API devolvía éxito y el orden visible seguía igual.
