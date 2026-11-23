CREATE TABLE IF NOT EXISTS "collection_ratings" (
		collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		score INTEGER NOT NULL CONSTRAINT collection_ratings_score_check CHECK (score BETWEEN 1 AND 5),
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
		PRIMARY KEY (collection_id, user_id)
	);
