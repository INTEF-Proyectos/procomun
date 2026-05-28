ALTER TABLE "elpx_projects" ALTER COLUMN "elpx_metadata" SET DATA TYPE jsonb USING NULLIF(elpx_metadata, '')::jsonb;--> statement-breakpoint
ALTER TABLE "activity_events" ALTER COLUMN "metadata" SET DATA TYPE jsonb USING NULLIF(metadata, '')::jsonb;
