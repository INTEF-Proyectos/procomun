-- Issue #470 (ADR-0046): cola de miniaturas generadas en el servidor para los paquetes sin screenshot.png.
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "thumbnail_status" TEXT;
--> statement-breakpoint
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "thumbnail_file" TEXT;
--> statement-breakpoint
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "thumbnail_attempts" INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "thumbnail_error" TEXT;
--> statement-breakpoint
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "thumbnail_updated_at" TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "thumbnail_next_attempt_at" TIMESTAMPTZ;
--> statement-breakpoint
DO $$ BEGIN
		ALTER TABLE "elpx_projects" ADD CONSTRAINT "elpx_projects_thumbnail_status_check"
			CHECK (thumbnail_status IS NULL OR thumbnail_status IN ('pending', 'processing', 'done', 'empty', 'failed', 'skipped'));
	EXCEPTION WHEN duplicate_object THEN NULL;
	END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_elpx_projects_thumbnail_queue" ON "elpx_projects" ("thumbnail_next_attempt_at") WHERE thumbnail_status IN ('pending', 'processing');
