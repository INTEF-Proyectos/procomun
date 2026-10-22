-- Catálogo controlado de palabras clave (issue #384, ADR-0042). Extiende tags (ADR-0034).
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "catalog" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_catalog_label_unique" ON "tags" (lower(translate("label", 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUnN'))) WHERE "catalog";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tag_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"tag_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tag_aliases" ADD CONSTRAINT "tag_aliases_tag_id_tags_id_fk"
		FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tag_aliases_tag_normalized_unique" ON "tag_aliases" ("tag_id", "normalized");
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM tags WHERE catalog) THEN
		INSERT INTO tags (id, slug, label, catalog)
		SELECT v.id,
			CASE WHEN EXISTS (SELECT 1 FROM tags t WHERE t.slug = v.id)
				THEN v.id || '-catalogo' ELSE v.id END,
			v.label, true
		FROM (VALUES
			('lengua-y-literatura', 'Lengua y literatura'),
			('lenguas-extranjeras', 'Lenguas extranjeras'),
			('lectura-y-escritura', 'Lectura y escritura'),
			('comunicacion-oral', 'Comunicación oral'),
			('alfabetizacion-mediatica', 'Alfabetización mediática'),
			('matematicas', 'Matemáticas'),
			('calculo-y-resolucion-de-problemas', 'Cálculo y resolución de problemas'),
			('geometria', 'Geometría'),
			('estadistica-y-probabilidad', 'Estadística y probabilidad'),
			('biologia', 'Biología'),
			('geologia', 'Geología'),
			('fisica', 'Física'),
			('quimica', 'Química'),
			('astronomia', 'Astronomía'),
			('medio-ambiente-y-sostenibilidad', 'Medio ambiente y sostenibilidad'),
			('historia', 'Historia'),
			('geografia', 'Geografía'),
			('arte-y-patrimonio', 'Arte y patrimonio'),
			('filosofia-y-etica', 'Filosofía y ética'),
			('economia-y-emprendimiento', 'Economía y emprendimiento'),
			('ciudadania-y-derechos-humanos', 'Ciudadanía y derechos humanos'),
			('musica', 'Música'),
			('artes-plasticas-y-visuales', 'Artes plásticas y visuales'),
			('artes-escenicas', 'Artes escénicas'),
			('tecnologia', 'Tecnología'),
			('informatica', 'Informática'),
			('programacion-y-pensamiento-computacional', 'Programación y pensamiento computacional'),
			('robotica', 'Robótica'),
			('inteligencia-artificial', 'Inteligencia artificial'),
			('seguridad-y-bienestar-digital', 'Seguridad y bienestar digital'),
			('educacion-fisica-y-deporte', 'Educación física y deporte'),
			('salud-y-habitos-saludables', 'Salud y hábitos saludables'),
			('educacion-emocional', 'Educación emocional'),
			('inclusion-y-atencion-a-la-diversidad', 'Inclusión y atención a la diversidad'),
			('accesibilidad-y-diseno-universal-para-el-aprendizaje', 'Accesibilidad y diseño universal para el aprendizaje'),
			('convivencia-y-prevencion-del-acoso', 'Convivencia y prevención del acoso'),
			('igualdad-y-coeducacion', 'Igualdad y coeducación'),
			('interculturalidad', 'Interculturalidad'),
			('aprendizaje-basado-en-proyectos', 'Aprendizaje basado en proyectos'),
			('aprendizaje-basado-en-problemas', 'Aprendizaje basado en problemas'),
			('aprendizaje-cooperativo', 'Aprendizaje cooperativo'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'Gamificación y aprendizaje basado en juegos'),
			('investigacion-y-experimentacion', 'Investigación y experimentación'),
			('evaluacion-y-autoevaluacion', 'Evaluación y autoevaluación'),
			('competencia-digital', 'Competencia digital'),
			('competencia-digital-docente', 'Competencia digital docente'),
			('orientacion-academica-y-profesional', 'Orientación académica y profesional'),
			('desarrollo-profesional-docente', 'Desarrollo profesional docente'),
			('industria-y-procesos-tecnicos', 'Industria y procesos técnicos'),
			('servicios-socioculturales-y-a-la-comunidad', 'Servicios socioculturales y a la comunidad')
		) AS v(id, label)
		ON CONFLICT (id) DO NOTHING;
		INSERT INTO tag_aliases (id, tag_id, alias, normalized)
		SELECT v.tag_id || ':' || v.normalized, v.tag_id, v.alias, v.normalized
		FROM (VALUES
			('lectura-y-escritura', 'conciencia fonológica', 'conciencia fonologica'),
			('lectura-y-escritura', 'lectoescritura infantil', 'lectoescritura infantil'),
			('calculo-y-resolucion-de-problemas', 'fracciones', 'fracciones'),
			('calculo-y-resolucion-de-problemas', 'potencias', 'potencias'),
			('calculo-y-resolucion-de-problemas', 'suma', 'suma'),
			('calculo-y-resolucion-de-problemas', 'sumar', 'sumar'),
			('calculo-y-resolucion-de-problemas', 'resta', 'resta'),
			('calculo-y-resolucion-de-problemas', 'números decimales', 'numeros decimales'),
			('geometria', 'ángulos', 'angulos'),
			('geometria', 'rectas', 'rectas'),
			('geometria', 'figuras planas', 'figuras planas'),
			('geometria', 'perímetros', 'perimetros'),
			('estadistica-y-probabilidad', 'Estadística', 'estadistica'),
			('biologia', 'célula', 'celula'),
			('biologia', 'genes', 'genes'),
			('biologia', 'gametos', 'gametos'),
			('biologia', 'leyes de Mendel', 'leyes de mendel'),
			('astronomia', 'sistema solar', 'sistema solar'),
			('astronomia', 'el sistema solar', 'el sistema solar'),
			('astronomia', 'planetas', 'planetas'),
			('astronomia', 'universo', 'universo'),
			('medio-ambiente-y-sostenibilidad', 'reciclaje', 'reciclaje'),
			('medio-ambiente-y-sostenibilidad', 'sostenibilidad ambiental', 'sostenibilidad ambiental'),
			('medio-ambiente-y-sostenibilidad', 'economía circular', 'economia circular'),
			('programacion-y-pensamiento-computacional', 'programación creativa', 'programacion creativa'),
			('programacion-y-pensamiento-computacional', 'pensamiento computacional', 'pensamiento computacional'),
			('inteligencia-artificial', 'IA', 'ia'),
			('salud-y-habitos-saludables', 'hábitos saludables', 'habitos saludables'),
			('salud-y-habitos-saludables', 'nutrición', 'nutricion'),
			('accesibilidad-y-diseno-universal-para-el-aprendizaje', 'DUA', 'dua'),
			('convivencia-y-prevencion-del-acoso', 'bullying', 'bullying'),
			('convivencia-y-prevencion-del-acoso', 'acoso escolar', 'acoso escolar'),
			('convivencia-y-prevencion-del-acoso', 'resolución de conflictos', 'resolucion de conflictos'),
			('aprendizaje-basado-en-proyectos', 'ABP', 'abp'),
			('aprendizaje-basado-en-problemas', 'ABP', 'abp'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'escape room', 'escape room'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'escaperoom', 'escaperoom'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'scape room', 'scape room'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'Breakout', 'breakout'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'BreakOut Digital', 'breakout digital'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'BreakOut Edu', 'breakout edu'),
			('gamificacion-y-aprendizaje-basado-en-juegos', 'juegos educativos', 'juegos educativos'),
			('evaluacion-y-autoevaluacion', 'autoevaluación', 'autoevaluacion'),
			('competencia-digital', 'Competenciadigital', 'competenciadigital')
		) AS v(tag_id, alias, normalized)
		ON CONFLICT DO NOTHING;
	END IF;
END $$;
