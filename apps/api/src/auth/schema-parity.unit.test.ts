import { describe, expect, test } from "bun:test";
import { session, user } from "@procomun/db/schema";
import { admin as adminPlugin } from "better-auth/plugins";
import { getTableColumns } from "drizzle-orm";

/**
 * better-auth 1.7 valida el esquema Drizzle al primer uso del adaptador y
 * lanza SchemaMismatchError (500 en /sign-in) si falta cualquier campo que
 * un plugin añada al modelo user o session. Este test falla antes que el
 * login si el plugin admin incorpora un campo que las tablas no tienen.
 */
describe("paridad entre el plugin admin de better-auth y el esquema Drizzle", () => {
	const pluginSchema = adminPlugin().schema;
	const tables = {
		user: Object.keys(getTableColumns(user)),
		session: Object.keys(getTableColumns(session)),
	};

	for (const model of ["user", "session"] as const) {
		test(`todos los campos de ${model} existen en la tabla`, () => {
			const expected = Object.keys(pluginSchema[model]?.fields ?? {});
			expect(expected.length).toBeGreaterThan(0);
			for (const field of expected) {
				expect(tables[model]).toContain(field);
			}
		});
	}
});
