-- Revisión de #481 (ADR-0046, adenda 2026-11-03): la ruta de miniaturas busca el dueño del fichero en cada petición.
CREATE INDEX IF NOT EXISTS "idx_resources_thumbnail_url" ON "resources" ("thumbnail_url") WHERE thumbnail_url IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_elpx_projects_thumbnail_file" ON "elpx_projects" ("thumbnail_file") WHERE thumbnail_file IS NOT NULL;
