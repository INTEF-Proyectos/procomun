/**
 * Instancia Drizzle compartida.
 * PGlite en dev (sin DATABASE_URL), PostgreSQL en prod (con DATABASE_URL).
 * En PGlite, crea las tablas automáticamente si no existen.
 */

// Cargar .env desde la raíz del monorepo (bun --filter ejecuta desde apps/api/)
// Si no existe .env, usa .env.example como fallback para desarrollo local.
const rootDir = `${import.meta.dir}/../../..`;
const rootEnvPath = `${rootDir}/.env`;
const rootEnvExamplePath = `${rootDir}/.env.example`;
const rootEnv = Bun.file(rootEnvPath);
const rootEnvExample = Bun.file(rootEnvExamplePath);
const envFile = (await rootEnv.exists()) ? rootEnv : rootEnvExample;
if (envFile === rootEnv || (await envFile.exists())) {
	const text = await envFile.text();
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const val = trimmed
			.slice(eqIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (!process.env[key]) process.env[key] = val;
	}
}

import type { DrizzleDB } from "@procomun/db/repository";
import * as pgSchema from "@procomun/db/schema";

type AppDb = {
	db: DrizzleDB;
	provider: "pg";
};

let _db: AppDb | null = null;
let _initPromise: Promise<void> | null = null;

function createDb(): AppDb {
	if (process.env.DATABASE_URL) {
		const { drizzle } = require("drizzle-orm/bun-sql") as {
			drizzle: (url: string, opts: { schema: typeof pgSchema }) => DrizzleDB;
		};
		return {
			db: drizzle(process.env.DATABASE_URL, { schema: pgSchema }),
			provider: "pg",
		};
	}

	const { PGlite } = require("@electric-sql/pglite") as {
		PGlite: new (
			dataDir: string,
		) => {
			exec: (sql: string) => Promise<unknown>;
		};
	};
	const { drizzle } = require("drizzle-orm/pglite") as {
		drizzle: (client: unknown, opts: { schema: typeof pgSchema }) => DrizzleDB;
	};
	const dataDir =
		process.env.PGLITE_DIR ?? `${import.meta.dir}/../../../local-data`;
	const pglite = new PGlite(dataDir);

	_initPromise = (async () => {
		// PGlite ejecuta Postgres sobre WASM con una pila pequeña; bajo procesos
		// de larga vida y stacks async profundos (p. ej. el servidor de dev
		// durante la suite E2E), `check_stack_depth` se dispara en consultas
		// triviales ("stack depth limit exceeded") y deja la conexión inutilizable.
		// Ampliamos el límite al arrancar; si la plataforma lo rechaza, seguimos
		// con el valor por defecto en lugar de impedir el arranque.
		try {
			await pglite.exec("SET max_stack_depth = '7680kB'");
		} catch {
			// Sin cambios: usar el max_stack_depth por defecto.
		}
		const { createTables } = await import("@procomun/db/setup");
		await createTables(pglite);
	})();

	return { db: drizzle(pglite, { schema: pgSchema }), provider: "pg" };
}

export function getDb(): AppDb {
	if (!_db) _db = createDb();
	return _db;
}

export async function waitForDb() {
	getDb();
	if (_initPromise) await _initPromise;
}
