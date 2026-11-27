import type { Context } from "hono";
import type { AuthEnv } from "./middleware.ts";

// Viven en @procomun/db para que el frontend use las mismas reglas y no
// ofrezca acciones que la API rechaza (#399).
export {
	canManageCollection,
	canManageResource,
	collectionStatusChangeError,
	hasMinRole,
	isOthersPrivateCollectionDraft,
} from "@procomun/db/validation";

export function getCurrentUser(c: Context<AuthEnv>) {
	return c.get("user") as {
		id: string;
		role?: string;
		name?: string;
		email?: string;
	};
}
