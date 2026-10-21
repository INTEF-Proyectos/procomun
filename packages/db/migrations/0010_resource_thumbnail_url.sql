-- Issue #407: miniatura importada desde el campo preview del JSON legacy.
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "thumbnail_url" text;
