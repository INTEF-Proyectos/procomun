/**
 * Fortaleza orientativa de una contraseña nueva (issue #532).
 *
 * Lo que de verdad se exige es la longitud mínima de Better Auth; esto solo
 * ayuda a elegir. Sin dependencias: zxcvbn pesa unos 800 kB para un indicador.
 *
 * Sin mensajes de Paraglide a propósito: devuelve un nivel y la isla lo
 * traduce. Un `.ts` que importe el barrel de Paraglide hunde la cobertura
 * medida (ver el comentario de `roleLabel` en #545).
 */

/** El mismo que `minPasswordLength` de Better Auth (`apps/api/src/auth/config.ts`). */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordStrength = "too_short" | "weak" | "fair" | "strong";

export function passwordStrength(password: string): PasswordStrength {
	// Por debajo del mínimo no es un nivel de fortaleza: Better Auth la rechaza,
	// y llamarla «débil» haría pensar que vale.
	if (password.length < MIN_PASSWORD_LENGTH) return "too_short";

	// Un solo carácter repetido no aporta nada por largo que sea.
	if (new Set(password).size <= 2) return "weak";

	const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
		re.test(password),
	).length;

	// La longitud pesa más que la variedad: una frase larga es mejor que una
	// combinación corta rara, que es lo que recomiendan las guías actuales.
	if (password.length >= 20) return "strong";
	if (classes >= 4 || (classes >= 3 && password.length >= 12)) return "strong";
	if (classes >= 3) return "fair";
	return "weak";
}
