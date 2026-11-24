#!/bin/sh
# Entorno de pruebas: cada contenedor nuevo de `app` (actualización de
# Watchtower o `docker compose up` tras un cambio) empieza con la base de
# datos y las subidas vacías, y el seed de la imagen las vuelve a generar.
# Un simple reinicio del mismo contenedor conserva los datos: la marca vive
# en la capa del contenedor, no en un volumen.
set -e
if [ ! -f /app/.datos-regenerados ]; then
	echo "==> Contenedor nuevo: se vacían la base de datos y las subidas"
	bun -e "
		const sql = new Bun.SQL(process.env.DATABASE_URL);
		await sql\`DROP SCHEMA IF EXISTS public CASCADE\`;
		await sql\`DROP SCHEMA IF EXISTS drizzle CASCADE\`;
		await sql\`CREATE SCHEMA public\`;
		await sql.end();
	"
	find /app/local-data/uploads -mindepth 1 -delete
	touch /app/.datos-regenerados
fi
# Mismo arranque que docker-entrypoint.sh de la imagen, más el encolado de
# miniaturas: el seed crea los paquetes sin pedir su captura.
echo "==> Running seed..."
bun run apps/cli/src/index.ts seed || echo "Seed failed or already applied, continuing..."
bun run apps/cli/src/index.ts elpx:thumbnails || echo "No se pudieron encolar las miniaturas, continuing..."
echo "==> Starting API server..."
exec bun run apps/api/src/index.ts
