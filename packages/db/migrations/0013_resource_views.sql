-- Issue #421 (ADR-0044): contador de visitas por recurso y sesiones ya contadas.
CREATE TABLE IF NOT EXISTS "resource_view_counts" (
		resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
		view_count INTEGER NOT NULL DEFAULT 0,
		legacy_view_count INTEGER,
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_view_sessions" (
		resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
		session_hash VARCHAR(64) NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		CONSTRAINT resource_view_sessions_resource_session UNIQUE (resource_id, session_hash)
	);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS resource_view_sessions_created_at_idx ON resource_view_sessions (created_at);
