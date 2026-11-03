import { expect, test } from "@playwright/test";

/**
 * Editor bootstrap → HTTP preview activation.
 *
 * What is honestly testable end-to-end today: that the embedded-editor bootstrap
 * page injects the `previewSnapshot` config into the iframe
 * HTML. The bundled static editor (v4.0.1) predates the core HttpPreviewProvider,
 * so the full preview flow cannot be driven until a newer core editor release
 * ships (see ADR-0035, which amends point 10 of ADR-0038, and
 * docs/preview-serving-contract.md). This spec asserts
 * the wiring, not the (not-yet-available) full activation.
 *
 * The bootstrap is served unauthenticated (`/api/v1/exelearning-editor/*` is not
 * in sessionProtectedApiPatterns). If the static editor is not present in this
 * environment (the Docker build downloads it from the latest exelearning
 * release), the route 404s and the test skips with a clear reason rather than
 * failing on an infra dependency.
 */
test.describe("Embedded editor bootstrap — HTTP preview wiring", () => {
	test("injects the previewSnapshot config into the bootstrap HTML", async ({
		request,
	}) => {
		const res = await request.get("/api/v1/exelearning-editor/index.html");

		test.skip(
			res.status() === 404,
			"Static eXeLearning editor not present in this environment (Docker build downloads it).",
		);
		expect(res.status()).toBe(200);

		const html = await res.text();
		expect(html).toContain("__EXE_EMBEDDING_CONFIG__");
		// The HTTP preview transport (serving contract v2): protocol version + the
		// owner-gated management base and the authless serving base. No CSRF header
		// or query — auth is the same-origin better-auth cookie.
		expect(html).toContain("previewSnapshot");
		expect(html).toContain('managementUrl: "/api/v1/preview-session"');
		expect(html).toContain('managementBaseUrl: "/api/v1/preview-session"');
		expect(html).toContain('servingBaseUrl: "/api/v1/preview"');
	});
});
