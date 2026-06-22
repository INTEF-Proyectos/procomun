CREATE TABLE IF NOT EXISTS "reports" (
	id TEXT PRIMARY KEY,
	resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
	reporter_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
	reason VARCHAR(50) NOT NULL,
	description TEXT,
	status VARCHAR(20) NOT NULL DEFAULT 'pending',
	moderator_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
	resolution TEXT,
	action_taken VARCHAR(50),
	created_at TIMESTAMP NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
	resolved_at TIMESTAMP
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_reports_resource_id ON "reports"(resource_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_reports_status ON "reports"(status);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON "reports"(reporter_id);
