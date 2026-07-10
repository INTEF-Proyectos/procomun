import { ensureUser } from "../repository/users.ts";
import type { DrizzleDB } from "../repository/shared.ts";

/**
 * UUID fijo (no aleatorio) para el usuario de sistema usado como `ownerId` de
 * `upload_sessions` al importar recursos legacy. No se crea con credenciales
 * (ensureUser solo inserta la fila `user`), por lo que no puede autenticarse:
 * es una referencia de propiedad, no una cuenta operativa (ADR-0029).
 */
export const LEGACY_IMPORT_SYSTEM_USER_ID = "00000000-0000-0000-0000-00000000e1c1";
export const LEGACY_IMPORT_SYSTEM_USER_EMAIL = "legacy-procomun-import@system.local";

export async function ensureLegacyImportSystemUser(db: DrizzleDB) {
	return ensureUser(db, {
		id: LEGACY_IMPORT_SYSTEM_USER_ID,
		email: LEGACY_IMPORT_SYSTEM_USER_EMAIL,
		name: "Importador legacy Procomún",
		role: "admin",
	});
}
