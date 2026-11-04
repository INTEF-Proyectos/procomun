-- Issue #473: un recurso sin idioma en sus metadatos de origen queda sin idioma
-- en vez de recibir "es" por defecto.
ALTER TABLE "resources" ALTER COLUMN "language" DROP NOT NULL;
