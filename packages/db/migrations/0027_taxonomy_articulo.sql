-- #595: «Artículo» faltaba en la taxonomía resource-type que devuelve la API (el importador ya asigna el tipo desde #517). Idempotente: no pisa una fila existente.
INSERT INTO "taxonomies" ("id", "slug", "name", "type", "created_at", "updated_at")
VALUES ('rt-articulo', 'articulo', 'Artículo', 'resource-type', NOW(), NOW())
ON CONFLICT DO NOTHING;
