-- Issue #417: «Otros autores», texto libre opcional con el resto de autores.
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "other_authors" text;
