import type { Context } from "hono";
import { auth } from "../auth/config.ts";
import type { AuthEnv } from "../auth/middleware.ts";

// La regla vive en @procomun/db/validation, junto a canManageResource (#460).
export { canViewResource } from "@procomun/db/validation";

type SessionUser = { id: string; role?: string } | null;

export async function getSessionUser(
	c: Context | Context<AuthEnv>,
): Promise<SessionUser> {
	try {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		return session ? (session.user as { id: string; role?: string }) : null;
	} catch {
		return null;
	}
}
