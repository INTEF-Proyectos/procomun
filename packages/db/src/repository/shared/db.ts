import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
	PgDatabase,
	PgQueryResultHKT,
	PgTransaction,
} from "drizzle-orm/pg-core";
import type * as schema from "../../schema/index.ts";

/**
 * Esquema de la aplicación (todas las tablas y relaciones exportadas).
 * Fuente única para tipar la capa de datos (Lote 1 de ADR-0030).
 */
export type AppSchema = typeof schema;
export type AppSchemaRelations = ExtractTablesWithRelations<AppSchema>;

/**
 * Tipo real de la base Drizzle del proyecto.
 *
 * Sustituye el `Record` con índice `any` y métodos que devolvían `unknown`.
 * `PgliteDatabase` y `BunSQLDatabase` extienden `PgDatabase`, así que este
 * tipo cubre dev (PGlite) y prod (Bun SQL) sin un `any` genérico.
 */
export type DrizzleDB = PgDatabase<
	PgQueryResultHKT,
	AppSchema,
	AppSchemaRelations
>;

/** Transacción tipada con el mismo esquema (p. ej. en `db.transaction`). */
export type DrizzleTX = PgTransaction<
	PgQueryResultHKT,
	AppSchema,
	AppSchemaRelations
>;
