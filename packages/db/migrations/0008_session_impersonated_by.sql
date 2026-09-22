-- better-auth 1.7: el plugin admin declara session.impersonatedBy y el
-- adaptador Drizzle rechaza el esquema (SchemaMismatchError en /sign-in)
-- si la columna no existe.
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;
