-- Atomized tagging system (ADR-0034 / issue #76)
CREATE TABLE IF NOT EXISTS "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"canonical_tag_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_canonical_tag_id_tags_id_fk" FOREIGN KEY ("canonical_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_tags" (
	"resource_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_tags_resource_id_tag_id_pk" PRIMARY KEY("resource_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tags_label_idx" ON "tags" USING btree ("label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tags_usage_count_idx" ON "tags" USING btree ("usage_count");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tags_canonical_tag_id_idx" ON "tags" USING btree ("canonical_tag_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_tags_tag_id_idx" ON "resource_tags" USING btree ("tag_id");
