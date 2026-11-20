-- Denuncias de colecciones (issue #539). Una denuncia apunta a un recurso o a
-- una colección: exactamente uno de los dos. La tabla viene de la 0003, que no
-- está en el journal, así que se toca solo si existe.
ALTER TABLE IF EXISTS "reports" ALTER COLUMN "resource_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "reports" ADD COLUMN IF NOT EXISTS "collection_id" text REFERENCES "collections"("id") ON DELETE CASCADE;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "reports" ADD CONSTRAINT "reports_target_check"
		CHECK (("resource_id" IS NULL) <> ("collection_id" IS NULL));
EXCEPTION WHEN duplicate_object OR undefined_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE INDEX IF NOT EXISTS "idx_reports_collection_id" ON "reports" ("collection_id");
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
