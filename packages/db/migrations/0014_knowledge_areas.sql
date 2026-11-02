-- Áreas de conocimiento y familias profesionales (issue #448, ADR-0045).
-- Los bloques y las familias son listas cerradas en código; aquí solo sus ids.
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "retired_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"block_id" varchar(64) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "knowledge_areas" ADD CONSTRAINT "knowledge_areas_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_areas_label_unique" ON "knowledge_areas" (lower(translate("label", 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUnN')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_areas_block_idx" ON "knowledge_areas" ("block_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_knowledge_areas" (
	"resource_id" text NOT NULL,
	"area_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_knowledge_areas_resource_id_area_id_pk" PRIMARY KEY("resource_id","area_id"),
	CONSTRAINT "resource_knowledge_areas_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "resource_knowledge_areas_area_id_knowledge_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."knowledge_areas"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_knowledge_areas_area_idx" ON "resource_knowledge_areas" ("area_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_professional_families" (
	"resource_id" text NOT NULL,
	"family_id" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_professional_families_resource_id_family_id_pk" PRIMARY KEY("resource_id","family_id"),
	CONSTRAINT "resource_professional_families_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_professional_families_family_idx" ON "resource_professional_families" ("family_id");
--> statement-breakpoint
INSERT INTO knowledge_areas (id, label, block_id, position)
VALUES
	('artes-escenicas', 'Artes Escénicas', 'artes', 0),
	('artes-plasticas', 'Artes Plásticas', 'artes', 1),
	('artesania', 'Artesanía', 'artes', 2),
	('diseno-y-artes-graficas', 'Diseño y Artes Gráficas', 'artes', 3),
	('musica', 'Música', 'artes', 4),
	('cultura-audiovisual', 'Cultura Audiovisual', 'artes', 5),
	('ciencias-de-la-naturaleza', 'Ciencias de la Naturaleza', 'ciencias', 6),
	('astronomia', 'Astronomía', 'ciencias', 7),
	('biologia', 'Biología', 'ciencias', 8),
	('fisica', 'Física', 'ciencias', 9),
	('geologia', 'Geología', 'ciencias', 10),
	('quimica', 'Química', 'ciencias', 11),
	('matematicas', 'Matemáticas', 'ciencias', 12),
	('informatica-y-pensamiento-computacional', 'Informática y Pensamiento Computacional', 'ciencias', 13),
	('inteligencia-artificial', 'Inteligencia Artificial', 'ciencias', 14),
	('robotica', 'Robótica', 'ciencias', 15),
	('tecnologia', 'Tecnología', 'ciencias', 16),
	('ciencias-sociales', 'Ciencias Sociales', 'humanidades', 17),
	('cultura-clasica', 'Cultura Clásica', 'humanidades', 18),
	('economia', 'Economía', 'humanidades', 19),
	('filosofia', 'Filosofía', 'humanidades', 20),
	('geografia', 'Geografía', 'humanidades', 21),
	('historia', 'Historia', 'humanidades', 22),
	('psicologia', 'Psicología', 'humanidades', 23),
	('religiones', 'Religiones', 'humanidades', 24),
	('educacion-fisica-y-deporte', 'Educación Física y Deporte', 'educacion-fisica', 25),
	('lengua-espanola-y-literatura', 'Lengua Española y Literatura', 'lenguas', 26),
	('catalan-valenciano', 'Catalán / Valenciano', 'lenguas', 27),
	('euskera', 'Euskera', 'lenguas', 28),
	('gallego', 'Gallego', 'lenguas', 29),
	('lenguas-clasicas', 'Lenguas Clásicas', 'lenguas', 30),
	('literatura-universal', 'Literatura Universal', 'lenguas', 31),
	('ingles', 'Inglés', 'lenguas-extranjeras', 32),
	('frances', 'Francés', 'lenguas-extranjeras', 33),
	('aleman', 'Alemán', 'lenguas-extranjeras', 34),
	('otras-lenguas-extranjeras', 'Otras Lenguas Extranjeras', 'lenguas-extranjeras', 35),
	('educacion-ambiental-y-sostenibilidad', 'Educación Ambiental y Sostenibilidad', 'transversales', 36),
	('educacion-intercultural', 'Educación Intercultural', 'transversales', 37),
	('educacion-para-el-consumo-responsable', 'Educación para el Consumo Responsable', 'transversales', 38),
	('educacion-para-la-salud', 'Educación para la Salud', 'transversales', 39),
	('educacion-sexual-y-afectiva', 'Educación Sexual y Afectiva', 'transversales', 40),
	('educacion-vial', 'Educación Vial', 'transversales', 41),
	('competencia-digital-y-alfabetizacion-mediatica', 'Competencia Digital y Alfabetización Mediática', 'transversales', 42),
	('ajedrez', 'Ajedrez', 'transversales', 43),
	('efemerides', 'Efemérides', 'transversales', 44),
	('empresa-y-emprendimiento', 'Empresa y Emprendimiento', 'empresa', 45),
	('formacion-y-orientacion-laboral', 'Formación y Orientación Laboral', 'empresa', 46),
	('orientacion-academica-y-profesional', 'Orientación Académica y Profesional', 'empresa', 47),
	('inclusion-educativa', 'Inclusión Educativa', 'inclusion', 48),
	('patios-inclusivos', 'Patios Inclusivos', 'inclusion', 49),
	('ele', 'ELE (Español como Lengua Extranjera)', 'inclusion', 50),
	('tutoria', 'Tutoría', 'inclusion', 51),
	('educacion-civica-y-etica', 'Educación Cívica y Ética', 'inclusion', 52),
	('igualdad-y-coeducacion', 'Igualdad y Coeducación', 'inclusion', 53),
	('educacion-para-la-paz-y-la-convivencia', 'Educación para la Paz y la Convivencia', 'inclusion', 54),
	('pedagogia-y-practica-docente', 'Pedagogía y Práctica Docente', 'inclusion', 55)
ON CONFLICT DO NOTHING;
