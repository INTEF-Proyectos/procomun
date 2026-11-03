import { describe, expect, spyOn, test } from "bun:test";
import { apiAccessLogs } from "@procomun/db/schema";
import { Hono } from "hono";
import { getDb } from "../db.ts";
import { createElpxPreviewToken } from "../elpx/preview-token.ts";
import { auditMiddleware, redactAuditPath } from "./audit.ts";
import type { AuthEnv } from "./middleware.ts";

describe("redactAuditPath", () => {
	const ID = "756f4e31-18e6-4f16-b868-516c5b945d8b";

	test("redacts the previewId in the authless serving path", () => {
		expect(redactAuditPath(`/api/v1/preview/${ID}/index.html`)).toBe(
			"/api/v1/preview/:previewId/index.html",
		);
		expect(redactAuditPath(`/api/v1/preview/${ID}`)).toBe(
			"/api/v1/preview/:previewId",
		);
	});

	test("redacts the previewId in the management path too (same secret)", () => {
		expect(redactAuditPath(`/api/v1/preview-session/${ID}/revisions`)).toBe(
			"/api/v1/preview-session/:previewId/revisions",
		);
	});

	test("leaves unrelated paths and non-UUID segments untouched", () => {
		expect(redactAuditPath("/api/v1/resources/42/comments")).toBe(
			"/api/v1/resources/42/comments",
		);
		// A create (no id segment) has nothing to redact.
		expect(redactAuditPath("/api/v1/preview-session")).toBe(
			"/api/v1/preview-session",
		);
		// Only a full v4-UUID-shaped segment is redacted.
		expect(redactAuditPath("/api/v1/preview/not-a-uuid/x")).toBe(
			"/api/v1/preview/not-a-uuid/x",
		);
	});
});

// The #466 signed link for unpublished resources is a second capability URL:
// `/api/v1/elpx/preview/<hash>/<token>/…`. The HMAC token is the secret; the
// hash only names the package, so it is kept for auditing.
describe("redactAuditPath — signed .elpx preview (#466)", () => {
	const HASH = "a".repeat(64);

	test("replaces a real signed token and keeps the hash", () => {
		const token = createElpxPreviewToken(HASH);
		const redacted = redactAuditPath(
			`/api/v1/elpx/preview/${HASH}/${token}/html/page.html`,
		);

		expect(redacted).toBe(`/api/v1/elpx/preview/${HASH}/:token/html/page.html`);
		expect(redacted).not.toContain(token);
		expect(redacted).not.toContain(token.split(".")[1] as string);
	});

	test("redacts the token without a sub-path and with a trailing slash", () => {
		const token = createElpxPreviewToken(HASH);
		expect(redactAuditPath(`/api/v1/elpx/preview/${HASH}/${token}`)).toBe(
			`/api/v1/elpx/preview/${HASH}/:token`,
		);
		expect(redactAuditPath(`/api/v1/elpx/preview/${HASH}/${token}/`)).toBe(
			`/api/v1/elpx/preview/${HASH}/:token/`,
		);
	});

	test("redacts any token-shaped segment, valid or not", () => {
		// The audit runs before we know whether the token verifies, and a
		// near-miss (expired, other secret) is still a credential-looking value.
		expect(redactAuditPath(`/api/v1/elpx/preview/${HASH}/123.abc/x`)).toBe(
			`/api/v1/elpx/preview/${HASH}/:token/x`,
		);
	});

	test("leaves the stable published URL and the token-less prefix alone", () => {
		expect(redactAuditPath(`/api/v1/elpx/${HASH}/index.html`)).toBe(
			`/api/v1/elpx/${HASH}/index.html`,
		);
		expect(redactAuditPath(`/api/v1/elpx/preview/${HASH}`)).toBe(
			`/api/v1/elpx/preview/${HASH}`,
		);
		expect(redactAuditPath("/api/v1/elpx/embed-facade.js")).toBe(
			"/api/v1/elpx/embed-facade.js",
		);
	});
});

describe("auditMiddleware", () => {
	test("never breaks the response flow", async () => {
		const path = `/api/audit-test-${crypto.randomUUID()}`;
		const app = new Hono<AuthEnv>();

		app.use("*", async (c, next) => {
			c.set("user", null);
			c.set("session", null);
			await next();
		});
		app.use("/api/*", auditMiddleware);
		app.get(path, (c) => c.json({ ok: true }));

		const response = await app.request(path, {
			headers: {
				"user-agent": "bun-test",
				"x-real-ip": "127.0.0.1",
			},
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	test("hands neither capability to the api_access_logs insert", async () => {
		const hash = crypto.randomUUID().replace(/-/g, "");
		const token = createElpxPreviewToken(hash);
		const previewId = crypto.randomUUID();
		const app = new Hono<AuthEnv>();

		app.use("*", async (c, next) => {
			c.set("user", null);
			c.set("session", null);
			await next();
		});
		app.use("/api/*", auditMiddleware);
		app.get("/api/*", (c) => c.text("ok"));

		// The test PGlite schema has no api_access_logs table, so capture the
		// row the middleware hands to the insert instead of reading it back.
		const { db } = getDb();
		const rows: { path: string }[] = [];
		const insert = spyOn(db, "insert").mockImplementation(((table: unknown) => {
			expect(table).toBe(apiAccessLogs);
			return {
				values: (row: { path: string }) => {
					rows.push(row);
					return Promise.resolve();
				},
			};
		}) as unknown as typeof db.insert);

		try {
			await app.request(`/api/v1/elpx/preview/${hash}/${token}/index.html`);
			await app.request(`/api/v1/preview/${previewId}/index.html`);
		} finally {
			insert.mockRestore();
		}

		expect(rows.map((r) => r.path)).toEqual([
			`/api/v1/elpx/preview/${hash}/:token/index.html`,
			"/api/v1/preview/:previewId/index.html",
		]);
		for (const { path } of rows) {
			expect(path).not.toContain(token);
			expect(path).not.toContain(previewId);
		}
	});
});
