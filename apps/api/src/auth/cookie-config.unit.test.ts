import { describe, expect, test } from "bun:test";

import { AUTH_DEFAULT_COOKIE_ATTRIBUTES } from "./cookie-config.ts";

describe("auth cookie hardening", () => {
	test("pins the session cookie to SameSite=Lax", () => {
		// The CSRF posture (no CSRF token, SameSite cookie only) depends on this.
		// If a better-auth upgrade or a refactor weakens it to 'none'/'strict',
		// this must break loudly.
		expect(AUTH_DEFAULT_COOKIE_ATTRIBUTES.sameSite).toBe("lax");
	});

	test("does not override secure/httpOnly (left to better-auth env logic)", () => {
		// Pinning secure=false here would disable Secure cookies in production.
		expect(AUTH_DEFAULT_COOKIE_ATTRIBUTES).not.toHaveProperty("secure");
		expect(AUTH_DEFAULT_COOKIE_ATTRIBUTES).not.toHaveProperty("httpOnly");
	});
});
