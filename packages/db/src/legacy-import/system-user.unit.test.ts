import { describe, expect, it, afterAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createTables } from "../setup.ts";
import * as schema from "../schema/index.ts";
import { user } from "../schema/auth.ts";
import {
	LEGACY_IMPORT_SYSTEM_USER_EMAIL,
	LEGACY_IMPORT_SYSTEM_USER_ID,
	ensureLegacyImportSystemUser,
} from "./system-user.ts";

describe("ensureLegacyImportSystemUser", () => {
	const pglite = new PGlite();
	const db = drizzle(pglite, { schema });

	afterAll(async () => {
		await pglite.close();
	});

	it("creates the system user idempotently without login credentials", async () => {
		await createTables(pglite);

		const first = await ensureLegacyImportSystemUser(db);
		expect(first?.id).toBe(LEGACY_IMPORT_SYSTEM_USER_ID);
		expect(first?.email).toBe(LEGACY_IMPORT_SYSTEM_USER_EMAIL);

		// Re-ejecutar no debe fallar ni duplicar (ensureUser usa onConflictDoNothing).
		const second = await ensureLegacyImportSystemUser(db);
		expect(second?.id).toBe(LEGACY_IMPORT_SYSTEM_USER_ID);

		const rows = await db.select().from(user).where(eq(user.id, LEGACY_IMPORT_SYSTEM_USER_ID));
		expect(rows.length).toBe(1);
		expect(rows[0]?.role).toBe("admin");
	});
});
