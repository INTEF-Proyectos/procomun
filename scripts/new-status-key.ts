/**
 * Genera una clave map-keyed para status.yaml (ADR-0019).
 *
 * Formato nuevo (desde 2026-07-17): T-YYYY-MM-DD-HHMMSSrr
 *   - YYYY-MM-DD: fecha UTC
 *   - HHMMSS: hora:minuto:segundo UTC
 *   - rr: dos dígitos aleatorios (00–99) para que dos ramas abiertas
 *     el mismo segundo no elijan la misma clave
 *
 * El formato antiguo T-YYYY-MM-DD-NNN sigue siendo válido en entradas
 * históricas; no se reescribe. El validador (check-tracking) acepta
 * cualquier sufijo numérico tras la fecha.
 *
 * Uso:
 *   bun run new-status-key
 *   bun run scripts/new-status-key.ts
 */

/** Clave de tarea: T- + fecha + sufijo numérico (NNN legacy o HHMMSSrr). */
export const STATUS_TASK_KEY_RE = /^T-\d{4}-\d{2}-\d{2}-\d+$/;

export type NewStatusKeyOptions = {
	/** Instantáneo de referencia (por defecto: ahora). Útil en tests. */
	now?: Date;
	/** Fuente de aleatoriedad en [0, 1). Por defecto Math.random. */
	random?: () => number;
};

/**
 * Construye una clave única para una entrada nueva de status.yaml.
 * Usa UTC para que dos agentes en husos distintos el mismo día no
 * diverjan en la parte de fecha.
 */
export function newStatusKey(options: NewStatusKeyOptions = {}): string {
	const now = options.now ?? new Date();
	const random = options.random ?? Math.random;

	const y = now.getUTCFullYear();
	const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
	const d = String(now.getUTCDate()).padStart(2, "0");
	const hh = String(now.getUTCHours()).padStart(2, "0");
	const mm = String(now.getUTCMinutes()).padStart(2, "0");
	const ss = String(now.getUTCSeconds()).padStart(2, "0");
	// 00–99; Math.floor(random()*100) es suficiente frente a colisiones
	// de numeración secuencial diaria que se venían produciendo.
	const r = random();
	const rr = String(Math.min(99, Math.max(0, Math.floor(r * 100)))).padStart(
		2,
		"0",
	);

	return `T-${y}-${mo}-${d}-${hh}${mm}${ss}${rr}`;
}

if (import.meta.main) {
	console.log(newStatusKey());
}
