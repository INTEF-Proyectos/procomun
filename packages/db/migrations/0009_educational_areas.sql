-- Categorización educativa de dos niveles (issue #380).
-- option_id NULL significa «solo categoría». No reutiliza resource_levels
-- ni resource_subjects.
CREATE TABLE IF NOT EXISTS "resource_educational_areas" (
	"resource_id" text NOT NULL,
	"category_id" varchar(64) NOT NULL,
	"option_id" varchar(64),
	CONSTRAINT "resource_educational_areas_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_educational_areas_category_only_uidx" ON "resource_educational_areas" ("resource_id", "category_id") WHERE "option_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_educational_areas_option_uidx" ON "resource_educational_areas" ("resource_id", "category_id", "option_id") WHERE "option_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_educational_areas_lookup_idx" ON "resource_educational_areas" ("category_id", "option_id");
