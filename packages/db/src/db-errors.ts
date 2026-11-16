/**
 * Errores de la base de datos sin datos de la base de datos (#488).
 *
 * Un error de Drizzle lleva en `message` la consulta SQL y sus parámetros, y
 * el del driver puede llevar la fila rechazada en `detail` o el valor en su
 * propio `message`: correos, hashes de contraseñas, autores. Por eso un error
 * de la base de datos nunca se registra entero: se resume en un código
 * controlado, el SQLSTATE y el nombre de la restricción. Nunca se copian
 * `message`, `detail`, `query`, `params` ni la cadena de causas.
 *
 * Lo usan los importadores legacy (apps/cli/src/import-errors.ts) y la API al
 * sustituir hashes de contraseñas heredadas (apps/api/src/auth/config.ts).
 */

export type DbErrorCode =
	/** Restricción única sobre el correo. */
	| "duplicate_email"
	/** Otra restricción (23xxx): se da su nombre. */
	| "constraint_violation"
	/** Cualquier otro error de la base de datos. */
	| "db_error"
	/** Error que no es de la base de datos en un paso que solo la usa. */
	| "unexpected_error";

export interface DbErrorSummary<Code extends string = DbErrorCode> {
	code: Code;
	/** Texto fijo, o el de un error propio de quien llama; nunca el de la BD. */
	message: string;
	/** SQLSTATE de Postgres, p. ej. 23505. */
	sqlState?: string;
	/** Nombre de la restricción, si la base de datos lo da. */
	constraint?: string;
}

const DB_MESSAGES = {
	duplicate_email: "el correo ya pertenece a otra cuenta",
	constraint_violation:
		"la base de datos rechazó el registro por una restricción",
	db_error: "error de la base de datos",
} as const;

/** SQLSTATE: cinco caracteres, cifras y mayúsculas (23505, 22P02, P0001). */
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
/** Identificador de Postgres sin comillas: lo único que se copia del error. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
/** Clase del error de JavaScript (TypeError, RangeError…). */
const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_CAUSE_DEPTH = 8;

type ErrorFields = Record<string, unknown>;

function asFields(value: unknown): ErrorFields | null {
	return value !== null && typeof value === "object"
		? (value as ErrorFields)
		: null;
}

/** El error y sus causas (`cause`), sin repetir y con un límite. */
function errorChain(error: unknown): ErrorFields[] {
	const chain: ErrorFields[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (chain.length < MAX_CAUSE_DEPTH && !seen.has(current)) {
		const fields = asFields(current);
		if (!fields) break;
		seen.add(current);
		chain.push(fields);
		current = fields.cause;
	}
	return chain;
}

function sqlStateOf(fields: ErrorFields): string | undefined {
	// pg y PGlite: `code`; Bun.SQL: `errno` (su `code` es ERR_POSTGRES_…).
	for (const value of [fields.code, fields.errno]) {
		if (typeof value === "string" && SQLSTATE_RE.test(value)) return value;
	}
	return undefined;
}

function constraintOf(fields: ErrorFields): string | undefined {
	// pg, PGlite y Bun.SQL: `constraint`; postgres.js: `constraint_name`.
	for (const value of [fields.constraint, fields.constraint_name]) {
		if (typeof value === "string" && IDENTIFIER_RE.test(value)) return value;
	}
	return undefined;
}

/** Error de Drizzle (DrizzleQueryError) o del driver con la consulta. */
function carriesQuery(fields: ErrorFields): boolean {
	return "query" in fields && "params" in fields;
}

/**
 * Error de Postgres: SQLSTATE más `severity` (un `EPERM` de Node tiene cinco
 * mayúsculas pero no `severity`), o un código de Bun.SQL.
 */
function isPostgresError(fields: ErrorFields): boolean {
	if (sqlStateOf(fields) && typeof fields.severity === "string") return true;
	return (
		typeof fields.code === "string" && fields.code.startsWith("ERR_POSTGRES_")
	);
}

/**
 * Resume un error de la base de datos, o devuelve null si no lo es. Busca en
 * toda la cadena de causas: Drizzle envuelve el error del driver.
 */
export function describeDbError(error: unknown): DbErrorSummary | null {
	const chain = errorChain(error);
	if (
		!chain.some((fields) => carriesQuery(fields) || isPostgresError(fields))
	) {
		return null;
	}
	const sqlState = chain.map(sqlStateOf).find(Boolean);
	const constraint = chain.map(constraintOf).find(Boolean);
	const code =
		sqlState === "23505" && constraint?.toLowerCase().includes("email")
			? "duplicate_email"
			: sqlState?.startsWith("23")
				? "constraint_violation"
				: "db_error";
	return {
		code,
		message: DB_MESSAGES[code],
		...(sqlState ? { sqlState } : {}),
		...(constraint && code !== "db_error" ? { constraint } : {}),
	};
}

/**
 * Para pasos que solo usan la base de datos: nunca se copia el mensaje. Si
 * no es un error de la base de datos, queda la clase del error.
 */
export function summarizeDbStepError(error: unknown): DbErrorSummary {
	const described = describeDbError(error);
	if (described) return described;
	const name = error instanceof Error ? error.name : undefined;
	return {
		code: "unexpected_error",
		message:
			name && ERROR_NAME_RE.test(name)
				? `error inesperado (${name})`
				: "error inesperado",
	};
}
