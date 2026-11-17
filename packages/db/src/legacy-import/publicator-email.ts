/**
 * Correo de quien publicó el recurso en el Procomún antiguo
 * (`publicatorEmailStr`). Allí el correo es el identificador único de la
 * cuenta (#456), así que es la clave para asignar el recurso a su cuenta
 * nueva. Se compara sin espacios y en minúsculas, igual que `user.email`
 * (índice único `user_email_lower_unique`). No se valida el formato: un valor
 * que no sea un correo simplemente no coincidirá con ninguna cuenta.
 */
export function normalizeLegacyPublicatorEmail(value: unknown): string | null {
	if (typeof value !== "string") return null;
	return value.trim().toLowerCase() || null;
}
