-- Issue #533: el «Sobre mí» queda solo en user_profile.about, privado como el resto del perfil
-- (ADR-0037). Se le pasa el user.bio escrito en la plataforma nueva y se borra la columna. Idempotente.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'user' AND column_name = 'bio'
	) THEN
		INSERT INTO "user_profile" (user_id, about)
		SELECT id, bio FROM "user" WHERE bio IS NOT NULL AND btrim(bio) <> ''
		ON CONFLICT (user_id) DO UPDATE SET about = EXCLUDED.about, updated_at = now();
		ALTER TABLE "user" DROP COLUMN "bio";
	END IF;
END $$;
