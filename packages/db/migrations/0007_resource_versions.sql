-- Versionado de recursos (issue #31 / ADR-0039)
-- Cada nuevo .elpx crea una versión inmutable; resources mantiene la
-- proyección de la versión vigente vía current_version_id.

ALTER TABLE "elpx_projects" DROP CONSTRAINT IF EXISTS "elpx_projects_resource_id_key";
--> statement-breakpoint
ALTER TABLE "elpx_projects" DROP CONSTRAINT IF EXISTS "elpx_projects_resource_id_unique";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"elpx_project_id" text NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"metadata_snapshot" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_versions_resource_id_version_number_unique" UNIQUE("resource_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_elpx_project_id_elpx_projects_id_fk" FOREIGN KEY ("elpx_project_id") REFERENCES "public"."elpx_projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_versions_resource_id" ON "resource_versions" USING btree ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resource_versions_elpx_project_id" ON "resource_versions" USING btree ("elpx_project_id");
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "current_version_id" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "resources" ADD CONSTRAINT "resources_current_version_id_fk"
		FOREIGN KEY ("current_version_id") REFERENCES "public"."resource_versions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
