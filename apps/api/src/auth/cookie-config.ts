/**
 * Session-cookie hardening pinned independently of better-auth's defaults.
 *
 * Kept in its own DB-free module (config.ts pulls in the database adapter) so the
 * security invariant is unit-testable without spinning up the auth stack.
 */

/**
 * Explicitly pin the session cookie to `SameSite=Lax`. better-auth's current
 * default is already `lax`, but the entire preview + REST CSRF posture leans on
 * the SameSite cookie (there is no CSRF token), so we pin it rather than inherit
 * it: a future better-auth upgrade that changed the default must not be able to
 * silently weaken this to `none`. `secure`/`httpOnly` are intentionally left to
 * better-auth's env-driven logic (secure auto-enables on https/production).
 */
export const AUTH_DEFAULT_COOKIE_ATTRIBUTES = { sameSite: "lax" } as const;
