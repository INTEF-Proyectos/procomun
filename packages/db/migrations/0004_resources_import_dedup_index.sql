CREATE UNIQUE INDEX IF NOT EXISTS resources_import_source_external_id_idx
	ON "resources"(import_source, external_id)
	WHERE external_id IS NOT NULL;
