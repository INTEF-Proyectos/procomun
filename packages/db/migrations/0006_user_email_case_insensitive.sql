DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "user"
		GROUP BY lower(email)
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION
			'No se puede crear user_email_lower_unique: existen emails que solo difieren en mayúsculas/minúsculas. Resuelva esos conflictos antes de reintentar la migración.';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_email_lower_unique
	ON "user" (lower(email));
