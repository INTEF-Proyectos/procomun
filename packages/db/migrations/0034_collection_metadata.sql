ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS language VARCHAR(10);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS educational_areas JSONB NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_keywords" (
		collection_id TEXT NOT NULL REFERENCES "collections"(id) ON DELETE CASCADE,
		tag_id TEXT NOT NULL REFERENCES "tags"(id) ON DELETE CASCADE,
		PRIMARY KEY (collection_id, tag_id)
	);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_knowledge_areas" (
		collection_id TEXT NOT NULL REFERENCES "collections"(id) ON DELETE CASCADE,
		area_id TEXT NOT NULL REFERENCES "knowledge_areas"(id) ON DELETE CASCADE,
		PRIMARY KEY (collection_id, area_id)
	);
