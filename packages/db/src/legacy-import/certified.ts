/**
 * Campo `certified` del JSON legacy (issue #420, ADR-0049 punto 10). Marca los
 * 877 recursos validados por expertos en el Procomún antiguo. Llega como
 * número (en las muestras, `null` y `0`). Con el mismo criterio que
 * `published` (#447), solo `1`, como número o como texto, cuenta como
 * validado; cualquier otro valor, no.
 */
export function isLegacyCertified(value: unknown): boolean {
	if (value === true) return true;
	if (typeof value === "number") return value === 1;
	if (typeof value === "string") return value.trim() === "1";
	return false;
}
