/**
 * Acceso seguro a los mapas de etiquetas indexados por un valor que llega de
 * la API (#576). Con `map[key]`, una clave heredada del prototipo
 * (`constructor`, `toString`, `__proto__`…) devuelve una función u objeto en
 * lugar del respaldo. Aquí solo cuentan las claves propias del mapa.
 */
export function labelFor<V>(
	map: Readonly<Record<string, V>>,
	key: string | null | undefined,
): V | undefined;
export function labelFor<V, F>(
	map: Readonly<Record<string, V>>,
	key: string | null | undefined,
	fallback: F,
): V | F;
export function labelFor<V, F>(
	map: Readonly<Record<string, V>>,
	key: string | null | undefined,
	fallback?: F,
): V | F | undefined {
	if (key != null && Object.hasOwn(map, key)) {
		const value = map[key];
		if (value !== undefined) return value;
	}
	return fallback;
}
