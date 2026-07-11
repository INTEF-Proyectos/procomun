import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "./middleware.ts";
import { auditMiddleware, redactAuditPath } from "./audit.ts";

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
});
