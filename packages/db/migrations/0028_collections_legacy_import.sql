-- Issue #432: los itinerarios del Procomún antiguo se importan como colecciones.
-- (import_source, external_id) identifica el itinerario de origen, como en
-- resources (0004): reimportar actualiza la colección en vez de duplicarla.
-- published_at conserva la fecha de publicación del Procomún antiguo.
-- La 0020 y la 0021 están reservadas por #512.
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "import_source" text;
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collections_import_source_external_id_idx"
	ON "collections" ("import_source", "external_id")
	WHERE "external_id" IS NOT NULL;
