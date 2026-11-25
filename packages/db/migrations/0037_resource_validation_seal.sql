-- Issue #420, ADR-0049 (adenda 2026-11-16): sello «Validado».
-- validated_at no nulo = recurso validado. validated_by es el curator o admin
-- que lo aprobó (nulo en los importados con `certified`), y validation_source
-- dice de dónde sale el sello: «review» (aprobado tras revisión) o «legacy».
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "validated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "validated_by" text;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "validation_source" varchar(20);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "resources" ADD CONSTRAINT "resources_validated_by_user_id_fk"
		FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "resources" ADD CONSTRAINT "resources_validation_source_check"
		CHECK ("validation_source" IS NULL OR "validation_source" IN ('review', 'legacy'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
