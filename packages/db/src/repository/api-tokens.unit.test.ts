import { expect, test, describe, beforeEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	createApiToken,
	listApiTokens,
	revokeApiToken,
	validateApiToken,
	deleteApiToken,
	hashToken,
	generateToken,
} from "./api-tokens.ts";
import { ensureUser } from "./users.ts";

describe("api-tokens repository", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		// Create a test user
		await ensureUser(db, { id: "user-1", email: "test@example.com", name: "Test User" });
	});

	test("generateToken produces prefixed token", () => {
		const token = generateToken();
		expect(token.startsWith("pck_")).toBe(true);
		expect(token.length).toBe(44); // "pck_" + 40 hex chars
	});

	test("hashToken produces consistent SHA-256 hash", async () => {
		const hash1 = await hashToken("test-token");
		const hash2 = await hashToken("test-token");
		expect(hash1).toBe(hash2);
		expect(hash1.length).toBe(64); // SHA-256 hex
	});

	test("createApiToken returns token details", async () => {
		const result = await createApiToken(db, { userId: "user-1", name: "My Token" });
		expect(result.id).toBeDefined();
		expect(result.rawToken.startsWith("pck_")).toBe(true);
		expect(result.name).toBe("My Token");
		expect(result.tokenPrefix).toBe(result.rawToken.slice(0, 8));
		expect(result.createdAt).toBeInstanceOf(Date);
	});

	test("listApiTokens returns user tokens", async () => {
		await createApiToken(db, { userId: "user-1", name: "Token A" });
		await createApiToken(db, { userId: "user-1", name: "Token B" });

		const tokens = await listApiTokens(db, "user-1");
		expect(tokens.length).toBe(2);
		expect(tokens[0].name).toBeDefined();
		expect(tokens[0].tokenPrefix).toBeDefined();
		expect(tokens[0].requestCount).toBe(0);
	});

	test("validateApiToken succeeds with valid token", async () => {
		const created = await createApiToken(db, { userId: "user-1", name: "Valid" });
		const result = await validateApiToken(db, created.rawToken);
		expect(result).not.toBeNull();
		expect(result!.userId).toBe("user-1");
		expect(result!.tokenId).toBe(created.id);
	});

	test("validateApiToken fails with invalid token", async () => {
		const result = await validateApiToken(db, "pck_invalidtokenvalue1234567890123456789");
		expect(result).toBeNull();
	});

	test("revokeApiToken prevents validation", async () => {
		const created = await createApiToken(db, { userId: "user-1", name: "ToRevoke" });
		await revokeApiToken(db, created.id, "user-1");

		const result = await validateApiToken(db, created.rawToken);
		expect(result).toBeNull();
	});

	test("validateApiToken fails with expired token", async () => {
		const pastDate = new Date(Date.now() - 1000);
		const created = await createApiToken(db, { userId: "user-1", name: "Expired", expiresAt: pastDate });
		const result = await validateApiToken(db, created.rawToken);
		expect(result).toBeNull();
	});

	test("deleteApiToken removes the token", async () => {
		const created = await createApiToken(db, { userId: "user-1", name: "ToDelete" });
		await deleteApiToken(db, created.id, "user-1");

		const tokens = await listApiTokens(db, "user-1");
		expect(tokens.length).toBe(0);
	});

	test("listApiTokens does not show other users tokens", async () => {
		await ensureUser(db, { id: "user-2", email: "other@example.com", name: "Other" });
		await createApiToken(db, { userId: "user-1", name: "Mine" });
		await createApiToken(db, { userId: "user-2", name: "Theirs" });

		const tokens = await listApiTokens(db, "user-1");
		expect(tokens.length).toBe(1);
		expect(tokens[0].name).toBe("Mine");
	});
});
