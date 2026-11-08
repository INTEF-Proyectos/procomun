-- Issue #409: miniatura screenshot.png de eXeLearning 4 en la raíz del paquete.
ALTER TABLE "elpx_projects" ADD COLUMN IF NOT EXISTS "has_screenshot" boolean NOT NULL DEFAULT false;
