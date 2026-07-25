import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import {
	PREVIEW_MULTIPART_OVERHEAD_BYTES,
	previewMultipartMaxRequestBytes,
	registerRoutes,
	validatePreviewMultipartContentLength,
} from "./routes.ts";

describe("preview multipart raw body limit", () => {
	test("adds a bounded allowance for multipart metadata", () => {
		expect(previewMultipartMaxRequestBytes(1024)).toBe(
			1024 + PREVIEW_MULTIPART_OVERHEAD_BYTES,
		);
	});

	test("allows a missing Content-Length for the Bun transport cap to handle", () => {
		expect(validatePreviewMultipartContentLength(undefined, 1024)).toBeNull();
	});

	test("rejects invalid or negative Content-Length values", () => {
		expect(validatePreviewMultipartContentLength("invalid", 1024)).toEqual({
			status: 400,
			error: "Content-Length no válido",
		});
		expect(validatePreviewMultipartContentLength("-1", 1024)?.status).toBe(400);
	});

	test("accepts the exact limit and rejects the next byte", () => {
		expect(validatePreviewMultipartContentLength("1024", 1024)).toBeNull();
		expect(validatePreviewMultipartContentLength("1025", 1024)).toEqual({
			status: 413,
			error:
				"La petición de previsualización supera el tamaño máximo (1024 bytes)",
		});
	});
});

/**
 * The validator above is pure, so it stayed green while the middleware that
 * calls it was mounted on `/assets` and `/revisions` — paths the snapshot
 * contract removed. Nothing failed; the guard simply stopped covering anything.
 * These go through registerRoutes so the mounting itself is under test.
 */
describe("preview multipart body limit wiring", () => {
	function app(): Hono<AuthEnv> {
		const instance = new Hono<AuthEnv>();
		registerRoutes(instance);
		return instance;
	}

	test("guards the live publish endpoint", async () => {
		const response = await app().request("/api/v1/preview-session", {
			method: "POST",
			headers: {
				"Content-Length": String(previewMultipartMaxRequestBytes() + 1),
				"Content-Type": "multipart/form-data; boundary=x",
			},
		});

		expect(response.status).toBe(413);
	});

	test("lets an in-budget request through to the route's own auth", async () => {
		const response = await app().request("/api/v1/preview-session", {
			method: "POST",
			headers: {
				"Content-Length": "1024",
				"Content-Type": "multipart/form-data; boundary=x",
			},
		});

		// Not 413: the body bound passed and the request reached the router,
		// which rejects it for the unrelated reason that there is no session.
		expect(response.status).not.toBe(413);
	});
});
