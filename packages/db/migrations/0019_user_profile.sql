-- Perfil de usuario migrado del Procomún anterior (issue #456, ADR-0037 adenda 2026-10-27).
CREATE TABLE IF NOT EXISTS "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"country_code" varchar(2),
	"locality" text,
	"educational_center" text,
	"educational_center_url" text,
	"about" text,
	"website" text,
	"facebook" text,
	"linkedin" text,
	"twitter" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
