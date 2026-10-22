/**
 * Crea todas las tablas del esquema en una instancia PGlite.
 * Reutilizable por: API (dev local), CLI (seed), preview (navegador).
 */
export const SCHEMA_STATEMENTS = [
	// Extensions for Full Text Search (may not be available in PGlite)
	`DO $$ BEGIN
		CREATE EXTENSION IF NOT EXISTS unaccent;
	EXCEPTION WHEN OTHERS THEN
		RAISE NOTICE 'unaccent extension not available, skipping';
	END $$`,
	`CREATE TABLE IF NOT EXISTS "user" (
		id TEXT PRIMARY KEY,
		email VARCHAR(255) NOT NULL UNIQUE,
		email_verified BOOLEAN NOT NULL DEFAULT false,
		name TEXT,
		image TEXT,
		bio TEXT,
		role VARCHAR(50) NOT NULL DEFAULT 'reader',
		is_active BOOLEAN NOT NULL DEFAULT true,
		banned BOOLEAN DEFAULT false,
		ban_reason TEXT,
		ban_expires TIMESTAMP,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
		last_login_at TIMESTAMP,
		deleted_at TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS "session" (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		expires_at TIMESTAMP NOT NULL,
		token TEXT NOT NULL UNIQUE,
		ip_address TEXT,
		user_agent TEXT,
		impersonated_by TEXT,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "account" (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		account_id TEXT NOT NULL,
		provider_id TEXT NOT NULL,
		access_token TEXT,
		refresh_token TEXT,
		access_token_expires_at TIMESTAMP,
		refresh_token_expires_at TIMESTAMP,
		scope TEXT,
		id_token TEXT,
		password TEXT,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "verification" (
		id TEXT PRIMARY KEY,
		identifier TEXT NOT NULL,
		value TEXT NOT NULL,
		expires_at TIMESTAMP NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "resources" (
		id TEXT PRIMARY KEY,
		slug VARCHAR(512) NOT NULL UNIQUE,
		external_id TEXT,
		source_uri TEXT,
		title TEXT NOT NULL,
		description TEXT NOT NULL,
		language VARCHAR(10) NOT NULL,
		license VARCHAR(50) NOT NULL,
		resource_type VARCHAR(100) NOT NULL,
		keywords TEXT,
		author TEXT,
		other_authors TEXT,
		publisher TEXT,
		thumbnail_url TEXT,
		duration INTEGER,
		accessibility_features TEXT,
		accessibility_hazards TEXT,
		access_mode TEXT,
		created_by TEXT REFERENCES "user"(id),
		editorial_status VARCHAR(50) NOT NULL DEFAULT 'draft',
		assigned_curator_id TEXT REFERENCES "user"(id),
		curated_at TIMESTAMP,
		featured_at TIMESTAMP,
		imported_at TIMESTAMP,
		import_source TEXT,
		deleted_at TIMESTAMP,
		extracted_text TEXT,
		search_vector TSVECTOR,
		extraction_status VARCHAR(20) NOT NULL DEFAULT 'pending',
		extracted_at TIMESTAMP,
		extraction_error TEXT,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "media_items" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		type VARCHAR(50) NOT NULL,
		mime_type VARCHAR(255),
		url TEXT NOT NULL,
		file_size INTEGER,
		filename TEXT,
		is_primary BOOLEAN NOT NULL DEFAULT false
	)`,
	`CREATE TABLE IF NOT EXISTS "upload_sessions" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		media_item_id TEXT REFERENCES "media_items"(id) ON DELETE SET NULL,
		status VARCHAR(50) NOT NULL DEFAULT 'created',
		original_filename TEXT NOT NULL,
		mime_type VARCHAR(255),
		storage_key TEXT NOT NULL,
		public_url TEXT,
		checksum_algorithm VARCHAR(32),
		final_checksum TEXT,
		error_code VARCHAR(100),
		error_message TEXT,
		declared_size BIGINT,
		received_bytes BIGINT NOT NULL DEFAULT 0,
		expires_at TIMESTAMP,
		completed_at TIMESTAMP,
		cancelled_at TIMESTAMP,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "elpx_projects" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		hash VARCHAR(64) NOT NULL UNIQUE,
		extract_path TEXT NOT NULL,
		original_filename TEXT NOT NULL,
		upload_session_id TEXT,
		version INTEGER NOT NULL DEFAULT 3,
		has_preview BOOLEAN NOT NULL DEFAULT false,
		elpx_metadata JSONB,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "resource_subjects" (
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		subject VARCHAR(255) NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS "resource_levels" (
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		level VARCHAR(100) NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS "resource_educational_areas" (
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		category_id VARCHAR(64) NOT NULL,
		option_id VARCHAR(64)
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS resource_educational_areas_category_only_uidx ON resource_educational_areas (resource_id, category_id) WHERE option_id IS NULL`,
	`CREATE UNIQUE INDEX IF NOT EXISTS resource_educational_areas_option_uidx ON resource_educational_areas (resource_id, category_id, option_id) WHERE option_id IS NOT NULL`,
	`CREATE INDEX IF NOT EXISTS resource_educational_areas_lookup_idx ON resource_educational_areas (category_id, option_id)`,
	// Atomized tags (ADR-0034 / issue #76)
	`CREATE TABLE IF NOT EXISTS "tags" (
		id TEXT PRIMARY KEY,
		slug VARCHAR(255) NOT NULL UNIQUE,
		label TEXT NOT NULL,
		description TEXT,
		usage_count INTEGER NOT NULL DEFAULT 0,
		canonical_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "resource_tags" (
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		PRIMARY KEY (resource_id, tag_id)
	)`,
	`CREATE TABLE IF NOT EXISTS "collections" (
		id TEXT PRIMARY KEY,
		slug VARCHAR(512) NOT NULL UNIQUE,
		title TEXT NOT NULL,
		description TEXT NOT NULL,
		cover_image_url TEXT,
		is_ordered BOOLEAN NOT NULL DEFAULT false,
		editorial_status VARCHAR(50) NOT NULL DEFAULT 'draft',
		curator_id TEXT NOT NULL REFERENCES "user"(id),
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "collection_resources" (
		collection_id TEXT NOT NULL REFERENCES "collections"(id) ON DELETE CASCADE,
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		position INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS "taxonomies" (
		id TEXT PRIMARY KEY,
		slug VARCHAR(255) NOT NULL UNIQUE,
		name TEXT NOT NULL,
		type VARCHAR(100) NOT NULL DEFAULT 'category',
		parent_id TEXT REFERENCES taxonomies(id) ON DELETE SET NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	// Social tables
	`CREATE TABLE IF NOT EXISTS "ratings" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		score INTEGER NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
		UNIQUE(resource_id, user_id)
	)`,
	`CREATE TABLE IF NOT EXISTS "favorites" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		UNIQUE(resource_id, user_id)
	)`,
	`CREATE TABLE IF NOT EXISTS "downloads" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
		user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
		format VARCHAR(20) NOT NULL DEFAULT 'direct',
		created_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	// Indexes
	`CREATE TABLE IF NOT EXISTS "activity_events" (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		type VARCHAR(50) NOT NULL,
		resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
		resource_title TEXT,
		resource_slug VARCHAR(512),
		description TEXT NOT NULL,
		metadata JSONB,
		created_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE INDEX IF NOT EXISTS idx_ratings_resource_id ON ratings(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_favorites_resource_id ON favorites(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_downloads_resource_id ON downloads(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_activity_events_user_created ON activity_events(user_id, created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_slug ON resources(slug)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(editorial_status)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS user_email_lower_unique ON "user" (lower(email))`,
	`CREATE UNIQUE INDEX IF NOT EXISTS resources_import_source_external_id_idx ON resources(import_source, external_id) WHERE external_id IS NOT NULL`,
	`CREATE INDEX IF NOT EXISTS idx_upload_sessions_resource_id ON upload_sessions(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner_id ON upload_sessions(owner_id)`,
	`CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status)`,
	`CREATE INDEX IF NOT EXISTS idx_elpx_projects_hash ON elpx_projects(hash)`,
	`CREATE INDEX IF NOT EXISTS idx_elpx_projects_resource_id ON elpx_projects(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_taxonomies_type ON taxonomies(type)`,
	`CREATE INDEX IF NOT EXISTS tags_label_idx ON tags(label)`,
	`CREATE INDEX IF NOT EXISTS tags_usage_count_idx ON tags(usage_count)`,
	`CREATE INDEX IF NOT EXISTS tags_canonical_tag_id_idx ON tags(canonical_tag_id)`,
	`CREATE INDEX IF NOT EXISTS resource_tags_tag_id_idx ON resource_tags(tag_id)`,
	`CREATE TABLE IF NOT EXISTS "api_tokens" (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
		name VARCHAR(255) NOT NULL,
		token_hash VARCHAR(64) NOT NULL UNIQUE,
		token_prefix VARCHAR(8) NOT NULL,
		last_used_at TIMESTAMP,
		expires_at TIMESTAMP,
		revoked_at TIMESTAMP,
		request_count INTEGER NOT NULL DEFAULT 0,
		created_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`,
	`DO $$ BEGIN
		CREATE INDEX idx_resources_search_vector ON resources USING GIN (search_vector);
	EXCEPTION WHEN OTHERS THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN created_by TEXT REFERENCES "user"(id);
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "user" ADD COLUMN bio TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "user" ADD COLUMN deleted_at TIMESTAMP;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "session" ADD COLUMN impersonated_by TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN extracted_text TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN search_vector TSVECTOR;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN extraction_status VARCHAR(20) NOT NULL DEFAULT 'pending';
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN extracted_at TIMESTAMP;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN extraction_error TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`CREATE TABLE IF NOT EXISTS "platform_settings" (
		key VARCHAR(100) PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TIMESTAMP NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS "reports" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
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
	)`,
	`CREATE INDEX IF NOT EXISTS idx_reports_resource_id ON reports(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)`,
	`CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id)`,
	// Versionado de recursos (issue #31 / ADR-0039)
	// Un recurso puede tener varios proyectos elpx (historial): se elimina la
	// unicidad de resource_id en BDs creadas antes de este cambio.
	`ALTER TABLE "elpx_projects" DROP CONSTRAINT IF EXISTS "elpx_projects_resource_id_key"`,
	`ALTER TABLE "elpx_projects" DROP CONSTRAINT IF EXISTS "elpx_projects_resource_id_unique"`,
	`CREATE TABLE IF NOT EXISTS "resource_versions" (
		id TEXT PRIMARY KEY,
		resource_id TEXT NOT NULL REFERENCES "resources"(id) ON DELETE CASCADE,
		version_number INTEGER NOT NULL,
		elpx_project_id TEXT NOT NULL REFERENCES "elpx_projects"(id) ON DELETE RESTRICT,
		file_sha256 VARCHAR(64) NOT NULL,
		metadata_snapshot JSONB NOT NULL,
		created_by TEXT REFERENCES "user"(id),
		created_at TIMESTAMP NOT NULL DEFAULT NOW(),
		UNIQUE(resource_id, version_number)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_resource_versions_resource_id ON resource_versions(resource_id)`,
	`CREATE INDEX IF NOT EXISTS idx_resource_versions_elpx_project_id ON resource_versions(elpx_project_id)`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN current_version_id TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN thumbnail_url TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD COLUMN other_authors TEXT;
	EXCEPTION WHEN duplicate_column THEN NULL;
	END $$`,
	`DO $$ BEGIN
		ALTER TABLE "resources" ADD CONSTRAINT resources_current_version_id_fk
			FOREIGN KEY (current_version_id) REFERENCES resource_versions(id) ON DELETE SET NULL;
	EXCEPTION WHEN duplicate_object THEN NULL;
	END $$`,
] as const;

const SEED_TAXONOMIES = `
INSERT INTO taxonomies (id, slug, name, type, created_at, updated_at) VALUES
  ('rt-documento', 'documento', 'Documento', 'resource-type', NOW(), NOW()),
  ('rt-presentacion', 'presentacion', 'Presentacion', 'resource-type', NOW(), NOW()),
  ('rt-video', 'video', 'Video', 'resource-type', NOW(), NOW()),
  ('rt-audio', 'audio', 'Audio', 'resource-type', NOW(), NOW()),
  ('rt-imagen', 'imagen', 'Imagen', 'resource-type', NOW(), NOW()),
  ('rt-actividad-interactiva', 'actividad-interactiva', 'Actividad interactiva', 'resource-type', NOW(), NOW()),
  ('rt-secuencia-didactica', 'secuencia-didactica', 'Secuencia didactica', 'resource-type', NOW(), NOW()),
  ('rt-ejercicio', 'ejercicio', 'Ejercicio', 'resource-type', NOW(), NOW()),
  ('rt-evaluacion', 'evaluacion', 'Evaluacion', 'resource-type', NOW(), NOW()),
  ('rt-proyecto', 'proyecto', 'Proyecto', 'resource-type', NOW(), NOW()),
  ('lang-es', 'es', 'Espanol', 'language', NOW(), NOW()),
  ('lang-en', 'en', 'Ingles', 'language', NOW(), NOW()),
  ('lang-ca', 'ca', 'Catalan', 'language', NOW(), NOW()),
  ('lang-eu', 'eu', 'Euskera', 'language', NOW(), NOW()),
  ('lang-gl', 'gl', 'Gallego', 'language', NOW(), NOW()),
  ('lang-fr', 'fr', 'Frances', 'language', NOW(), NOW()),
  ('lang-pt', 'pt', 'Portugues', 'language', NOW(), NOW()),
  ('lang-de', 'de', 'Aleman', 'language', NOW(), NOW()),
  ('lang-it', 'it', 'Italiano', 'language', NOW(), NOW()),
  ('lic-cc-by', 'cc-by', 'CC BY', 'license', NOW(), NOW()),
  ('lic-cc-by-sa', 'cc-by-sa', 'CC BY-SA', 'license', NOW(), NOW()),
  ('lic-cc-by-nc', 'cc-by-nc', 'CC BY-NC', 'license', NOW(), NOW()),
  ('lic-cc-by-nc-sa', 'cc-by-nc-sa', 'CC BY-NC-SA', 'license', NOW(), NOW()),
  ('lic-cc-by-nc-nd', 'cc-by-nc-nd', 'CC BY-NC-ND', 'license', NOW(), NOW()),
  ('lic-cc-by-nd', 'cc-by-nd', 'CC BY-ND', 'license', NOW(), NOW()),
  ('lic-cc0', 'cc0', 'CC0 (Dominio publico)', 'license', NOW(), NOW())
ON CONFLICT (id) DO NOTHING
`;

const SEED_SETTINGS = `
INSERT INTO platform_settings (key, value, updated_at) VALUES
  ('badge_novedad_days', '30', NOW()),
  ('badge_destacado_min_ratings', '3', NOW()),
  ('badge_destacado_min_avg', '4.0', NOW()),
  ('badge_destacado_min_favorites', '3', NOW())
ON CONFLICT (key) DO NOTHING
`;

export async function createTables(executor: {
	exec: (sql: string) => Promise<unknown>;
}) {
	for (const statement of SCHEMA_STATEMENTS) {
		await executor.exec(statement);
	}
	await executor.exec(SEED_TAXONOMIES);
	await executor.exec(SEED_SETTINGS);
}
