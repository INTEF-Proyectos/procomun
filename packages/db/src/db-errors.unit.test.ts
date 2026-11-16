import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describeDbError, summarizeDbStepError } from "./db-errors.ts";
import * as schema from "./schema/index.ts";
import { createTables } from "./setup.ts";

/*
 * Utilidad compartida por los importadores (apps/cli/src/import-errors.ts,
 * con sus propios tests) y la API (#488). Aquí, lo que necesita la API: un
 * fallo real de Drizzle con datos sensibles en el mensaje y en los
 * parámetros se resume sin ninguno de ellos.
 */
const MARKER = "marcador-sensible-db-errors";

async function caught(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error("se esperaba un error");
}

describe("summarizeDbStepError con un error real de Drizzle", () => {
	let pglite: PGlite;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeAll(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await db.insert(schema.user).values({ id: "u1", email: "u1@example.test" });
		await db.insert(schema.account).values({
			id: "a1",
			userId: "u1",
			accountId: "u1",
			providerId: "credential",
			password: "anterior",
		});
		await pglite.exec(`
			CREATE FUNCTION falla() RETURNS trigger AS $$
			BEGIN RAISE EXCEPTION '${MARKER} %', NEW.password; END $$ LANGUAGE plpgsql;
			CREATE TRIGGER falla BEFORE UPDATE ON account
				FOR EACH ROW EXECUTE FUNCTION falla();
		`);
	});

	afterAll(async () => {
		await pglite.close();
	});

	test("da un código controlado y el SQLSTATE, sin mensaje, consulta ni parámetros", async () => {
		const error = await caught(() =>
			db
				.update(schema.account)
				.set({ password: `${MARKER}-hash` })
				.where(eq(schema.account.id, "a1")),
		);
		// El error original sí lleva el marcador en el mensaje y en los params.
		expect(Bun.inspect(error, { depth: 20 })).toContain(`${MARKER}-hash`);

		const summary = summarizeDbStepError(error);
		expect(summary).toEqual({
			code: "db_error",
			message: "error de la base de datos",
			sqlState: "P0001",
		});
		expect(describeDbError(error)).toEqual(summary);
		expect(JSON.stringify(summary)).not.toContain(MARKER);
	});

	test("un error que no es de la base de datos solo deja su clase", () => {
		const summary = summarizeDbStepError(new TypeError(MARKER));
		expect(summary).toEqual({
			code: "unexpected_error",
			message: "error inesperado (TypeError)",
		});
	});
});
