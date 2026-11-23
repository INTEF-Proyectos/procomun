ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_view_sessions" (
		collection_id TEXT NOT NULL REFERENCES "collections"(id) ON DELETE CASCADE,
		session_hash VARCHAR(64) NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		PRIMARY KEY (collection_id, session_hash)
	);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_view_sessions_collection_created_at_idx ON collection_view_sessions (collection_id, created_at);
