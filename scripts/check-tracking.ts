/**
 * Valida los ficheros de tracking map-keyed de ADR-0019: status.yaml y
 * docs/negocio/decisiones/decision-log.yaml.
 *
 * El motivo de existir de este script: una clave YAML duplicada NO es un error
 * de merge ni de parseo. Git ve dos ramas añadiendo texto distinto al final del
 * fichero y lo resuelve como cualquier otro conflicto textual; el parser YAML,
 * ante dos claves iguales, se queda con la última sin decir nada. El resultado
 * es que una entrada de historial desaparece en silencio, contra la regla 11 de
 * AGENTS.md, y nadie se entera. Pasó con T-2026-07-17-002, reclamada por tres
 * tareas distintas a la vez.
 *
 * Por eso las claves duplicadas se detectan sobre el TEXTO CRUDO: si se
 * buscaran sobre el objeto ya parseado no se verían nunca, porque el parser ya
 * habría descartado la repetida.
 */

const TASK_KEY_RE = /^ {2}(T-\d{4}-\d{2}-\d{2}-\d+):/;
const ADR_KEY_RE = /^(ADR-\d{4}[a-z]?):/;

/** Referencias que sí sabemos resolver dentro de `related:`. El resto (épicas,
 *  "#236", "DEF-003"...) se ignora a propósito: no hay índice contra el que
 *  comprobarlas. */
const TASK_REF_RE = /^T-\d{4}-\d{2}-\d{2}-\d+$/;
const ADR_REF_RE = /^ADR-\d{4}[a-z]?$/;

export type Duplicate = { key: string; lines: number[] };

/**
 * Busca claves repetidas en el texto crudo. La expresión regular fija también
 * la indentación, que es lo que distingue las entradas de status.yaml (2
 * espacios, bajo `tasks:`) de las de decision-log.yaml (nivel superior).
 */
export function findDuplicateKeys(raw: string, re: RegExp): Duplicate[] {
	const seen = new Map<string, number[]>();
	raw.split("\n").forEach((line, i) => {
		const m = line.match(re);
		if (!m?.[1]) return;
		const at = seen.get(m[1]) ?? [];
		at.push(i + 1);
		seen.set(m[1], at);
	});
	return [...seen.entries()]
		.filter(([, lines]) => lines.length > 1)
		.map(([key, lines]) => ({ key, lines }));
}

export function findDuplicateTaskKeys(raw: string): Duplicate[] {
	return findDuplicateKeys(raw, TASK_KEY_RE);
}

export function findDuplicateAdrKeys(raw: string): Duplicate[] {
	return findDuplicateKeys(raw, ADR_KEY_RE);
}

export type MissingFile = { key: string; file: string };

/** Entradas de decision-log.yaml cuyo `file:` no existe en disco. */
export function findMissingAdrFiles(
	decisions: Record<string, { file?: string }>,
	fileExists: (file: string) => boolean,
): MissingFile[] {
	const missing: MissingFile[] = [];
	for (const [key, entry] of Object.entries(decisions)) {
		if (!key.startsWith("ADR-")) continue;
		const file = entry?.file;
		if (!file) {
			missing.push({ key, file: "(sin campo file:)" });
			continue;
		}
		if (!fileExists(file)) missing.push({ key, file });
	}
	return missing;
}

export type DanglingRef = { from: string; ref: string };

/**
 * Referencias de `related:` a claves que no existen. Se devuelven como aviso,
 * no como error: mientras hay PRs abiertas en paralelo es normal y legítimo
 * apuntar a una entrada o ADR que aún no ha mergeado (una referencia
 * adelantada), y se resuelve sola cuando entra la otra rama.
 */
export function findDanglingRefs(
	tasks: Record<string, { related?: unknown }>,
	knownTaskKeys: Set<string>,
	knownAdrKeys: Set<string>,
): DanglingRef[] {
	const dangling: DanglingRef[] = [];
	for (const [key, entry] of Object.entries(tasks)) {
		const related = entry?.related;
		if (!Array.isArray(related)) continue;
		for (const raw of related) {
			if (typeof raw !== "string") continue;
			const ref = raw.trim();
			if (TASK_REF_RE.test(ref) && !knownTaskKeys.has(ref)) {
				dangling.push({ from: key, ref });
			} else if (ADR_REF_RE.test(ref) && !knownAdrKeys.has(ref)) {
				dangling.push({ from: key, ref });
			}
		}
	}
	return dangling;
}

const STATUS_FILE = "status.yaml";
const DECISIONS_DIR = "docs/negocio/decisiones";
const DECISION_LOG = `${DECISIONS_DIR}/decision-log.yaml`;

async function main() {
	const statusRaw = await Bun.file(STATUS_FILE).text();
	const logRaw = await Bun.file(DECISION_LOG).text();

	const status = Bun.YAML.parse(statusRaw) as {
		tasks?: Record<string, { related?: unknown }>;
	};
	const decisions = Bun.YAML.parse(logRaw) as Record<string, { file?: string }>;

	const tasks = status?.tasks ?? {};
	const errors: string[] = [];
	const warnings: string[] = [];

	for (const dup of findDuplicateTaskKeys(statusRaw)) {
		errors.push(
			`${STATUS_FILE}: la clave ${dup.key} está repetida (líneas ${dup.lines.join(", ")}). ` +
				"El parser se quedaría solo con la última y perdería el resto en silencio.",
		);
	}
	for (const dup of findDuplicateAdrKeys(logRaw)) {
		errors.push(
			`${DECISION_LOG}: la clave ${dup.key} está repetida (líneas ${dup.lines.join(", ")}).`,
		);
	}

	const missing = findMissingAdrFiles(
		decisions,
		(file) =>
			// Comprobación síncrona para poder testear la función con un stub.
			Bun.file(`${DECISIONS_DIR}/${file}`).size > 0,
	);
	for (const m of missing) {
		errors.push(
			`${DECISION_LOG}: ${m.key} apunta a "${m.file}", que no existe en ${DECISIONS_DIR}/.`,
		);
	}

	const adrKeys = new Set(
		Object.keys(decisions).filter((k) => k.startsWith("ADR-")),
	);
	for (const d of findDanglingRefs(
		tasks,
		new Set(Object.keys(tasks)),
		adrKeys,
	)) {
		warnings.push(
			`${STATUS_FILE}: ${d.from} referencia ${d.ref}, que no existe todavía.`,
		);
	}

	for (const w of warnings) console.warn(`⚠️  ${w}`);

	if (errors.length > 0) {
		console.error("\n❌ Ficheros de tracking inválidos:\n");
		for (const e of errors) console.error(`- ${e}`);
		console.error(
			"\nLas claves map-keyed de ADR-0019 deben ser únicas: si dos ramas en " +
				"paralelo eligen el mismo número, renumera la que aún no haya mergeado.",
		);
		process.exit(1);
	}

	const warnSuffix =
		warnings.length > 0
			? ` (${warnings.length} referencia(s) adelantada(s))`
			: "";
	console.log(
		`✅ Tracking válido: ${Object.keys(tasks).length} tareas y ${adrKeys.size} ADR, sin claves duplicadas${warnSuffix}`,
	);
}

if (import.meta.main) {
	await main();
}
