import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	describeDbError,
	formatImportError,
	summarizeDbStepError,
	summarizeImportError,
	withoutDbDetails,
} from "./import-errors.ts";

/** Valor sintético: si aparece en un resumen, se ha filtrado el error. */
const SECRET = "valor-sintetico-que-no-debe-salir";
const EMAIL = "persona-sintetica@example.test";

async function caught(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error("se esperaba un error");
}

describe("describeDbError con errores reales de Drizzle sobre PGlite", () => {
	let pglite: PGlite;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeAll(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await db.insert(schema.user).values({ id: "u1", email: EMAIL });
	});

	afterAll(async () => {
		await pglite.close();
	});

	test("una restricción CHECK da constraint_violation con su nombre y el SQLSTATE, sin la fila", async () => {
		await pglite.exec(
			"ALTER TABLE account ADD CONSTRAINT test_sin_contrasena CHECK (password IS NULL)",
		);
		const error = await caught(() =>
			db.insert(schema.account).values({
				id: "a1",
				userId: "u1",
				accountId: "u1",
				providerId: "credential",
				password: SECRET,
			}),
		);
		await pglite.exec(
			"ALTER TABLE account DROP CONSTRAINT test_sin_contrasena",
		);
		// El error original sí lleva el valor: es lo que no puede salir.
		expect(String((error as Error).message)).toContain(SECRET);

		const summary = describeDbError(error);
		expect(summary).toEqual({
			code: "constraint_violation",
			message: "la base de datos rechazó el registro por una restricción",
			sqlState: "23514",
			constraint: "test_sin_contrasena",
		});
		expect(JSON.stringify(summary)).not.toContain(SECRET);
	});

	test("un correo duplicado da duplicate_email, sin el correo", async () => {
		const error = await caught(() =>
			db.insert(schema.user).values({ id: "u2", email: EMAIL.toUpperCase() }),
		);
		const summary = describeDbError(error);
		expect(summary).toEqual({
			code: "duplicate_email",
			message: "el correo ya pertenece a otra cuenta",
			sqlState: "23505",
			constraint: "user_email_lower_unique",
		});
		expect(JSON.stringify(summary).toLowerCase()).not.toContain(
			EMAIL.toLowerCase(),
		);
	});

	test("cualquier otro fallo da db_error aunque Postgres meta el valor en su mensaje", async () => {
		const error = await caught(() => db.execute(sql`select ${EMAIL}::int`));
		expect(
			String(((error as Error).cause as Error | undefined)?.message),
		).toContain(EMAIL);

		const summary = describeDbError(error);
		expect(summary).toEqual({
			code: "db_error",
			message: "error de la base de datos",
			sqlState: "22P02",
		});
		expect(formatImportError(summary ?? summarizeDbStepError(error))).toBe(
			"db_error [SQLSTATE 22P02]: error de la base de datos",
		);
	});

	test("el error del driver sin envolver por Drizzle también se reconoce", async () => {
		const error = await caught(() => pglite.query("select $1::int", [EMAIL]));
		expect(describeDbError(error)).toMatchObject({
			code: "db_error",
			sqlState: "22P02",
		});
	});
});

describe("describeDbError con otras formas de error", () => {
	test("Bun.SQL guarda el SQLSTATE en errno y su propio código en code", () => {
		const error = Object.assign(new Error(`valor ${SECRET}`), {
			name: "PostgresError",
			code: "ERR_POSTGRES_SERVER_ERROR",
			errno: "23505",
			severity: "ERROR",
			constraint: "user_email_unique",
			detail: `Key (email)=(${EMAIL}) already exists.`,
		});
		expect(describeDbError(error)).toEqual({
			code: "duplicate_email",
			message: "el correo ya pertenece a otra cuenta",
			sqlState: "23505",
			constraint: "user_email_unique",
		});
	});

	test("postgres.js usa constraint_name", () => {
		const error = Object.assign(new Error(SECRET), {
			name: "PostgresError",
			code: "23503",
			severity: "ERROR",
			constraint_name: "account_user_id_user_id_fk",
		});
		expect(describeDbError(error)).toMatchObject({
			code: "constraint_violation",
			constraint: "account_user_id_user_id_fk",
		});
	});

	test("un nombre de restricción que no es un identificador no se copia", () => {
		const error = Object.assign(new Error(SECRET), {
			code: "23514",
			severity: "ERROR",
			constraint: `x ${EMAIL}`,
		});
		const summary = describeDbError(error);
		expect(summary).toEqual({
			code: "constraint_violation",
			message: "la base de datos rechazó el registro por una restricción",
			sqlState: "23514",
		});
	});

	test("los errores del sistema de ficheros no son de la base de datos", () => {
		const error = Object.assign(new Error("EPERM: operation not permitted"), {
			code: "EPERM",
		});
		expect(describeDbError(error)).toBeNull();
		expect(describeDbError(new Error("otra cosa"))).toBeNull();
		expect(describeDbError("texto")).toBeNull();
		expect(describeDbError(null)).toBeNull();
	});

	test("sigue la cadena de causas sin colgarse con ciclos", () => {
		const inner = Object.assign(new Error(SECRET), {
			code: "40001",
			severity: "ERROR",
		});
		const outer = new Error(`envoltorio ${SECRET}`, { cause: inner });
		expect(describeDbError(outer)).toMatchObject({
			code: "db_error",
			sqlState: "40001",
		});
		const cyclic = new Error("a") as Error & { cause?: unknown };
		cyclic.cause = cyclic;
		expect(describeDbError(cyclic)).toBeNull();
	});
});

describe("summarizeImportError y summarizeDbStepError", () => {
	test("summarizeImportError conserva el mensaje de los errores que no son de la base de datos", () => {
		expect(
			summarizeImportError(
				new Error("mail ausente o inválido"),
				"invalid_record",
			),
		).toEqual({ code: "invalid_record", message: "mail ausente o inválido" });
		expect(summarizeImportError("texto", "import_error")).toEqual({
			code: "import_error",
			message: "texto",
		});
	});

	test("summarizeDbStepError nunca copia el mensaje: solo la clase del error", () => {
		expect(summarizeDbStepError(new TypeError(SECRET))).toEqual({
			code: "unexpected_error",
			message: "error inesperado (TypeError)",
		});
		expect(summarizeDbStepError(SECRET)).toEqual({
			code: "unexpected_error",
			message: "error inesperado",
		});
		const odd = new Error(SECRET);
		odd.name = `Error ${EMAIL}`;
		expect(JSON.stringify(summarizeDbStepError(odd))).not.toContain(EMAIL);
	});

	test("formatImportError resume código, restricción y SQLSTATE", () => {
		expect(
			formatImportError({
				code: "constraint_violation",
				message: "la base de datos rechazó el registro por una restricción",
				sqlState: "23514",
				constraint: "c1",
			}),
		).toBe(
			"constraint_violation (c1) [SQLSTATE 23514]: la base de datos rechazó el registro por una restricción",
		);
		expect(
			formatImportError({ code: "invalid_record", message: "uid ausente" }),
		).toBe("invalid_record: uid ausente");
	});
});

describe("withoutDbDetails", () => {
	test("sustituye un error de la base de datos por otro con solo el resumen", () => {
		const dbError = Object.assign(new Error(`Failed query: ${SECRET}`), {
			query: "insert into account values ($1)",
			params: [SECRET],
		});
		const safe = withoutDbDetails(dbError);
		expect(safe).toBeInstanceOf(Error);
		expect((safe as Error).message).toBe("db_error: error de la base de datos");
		expect((safe as Error).cause).toBeUndefined();
		expect(JSON.stringify(safe)).not.toContain(SECRET);
	});

	test("deja tal cual los demás errores", () => {
		const other = new Error("Falta --source-file");
		expect(withoutDbDetails(other)).toBe(other);
	});
});
