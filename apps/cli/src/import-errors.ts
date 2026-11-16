/**
 * Errores de los importadores legacy sin datos de la base de datos (#488).
 *
 * El criterio para los errores de la base de datos (código controlado,
 * SQLSTATE y restricción; nunca `message`, `detail`, `query` ni `params`) es
 * el compartido de `@procomun/db/db-errors`, que también usa la API. Aquí
 * quedan los códigos y utilidades propios de los importadores.
 */
import {
	type DbErrorCode,
	type DbErrorSummary,
	describeDbError,
	summarizeDbStepError,
} from "@procomun/db/db-errors";

export { describeDbError, summarizeDbStepError };

export type ImportErrorCode =
	/** El registro de origen no es válido (mensaje propio del mapeo). */
	| "invalid_record"
	/** Fallo del procesado del fichero (mensaje propio, sin datos de la BD). */
	| "import_error"
	| DbErrorCode;

export type ImportErrorSummary = DbErrorSummary<ImportErrorCode>;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Para pasos que mezclan ficheros y base de datos: los errores de la base de
 * datos se resumen y los demás (mensajes propios del importador) se
 * conservan con el código indicado.
 */
export function summarizeImportError(
	error: unknown,
	code: "invalid_record" | "import_error",
): ImportErrorSummary {
	return describeDbError(error) ?? { code, message: errorMessage(error) };
}

/** Una línea para la consola: código, restricción, SQLSTATE y mensaje. */
export function formatImportError(summary: ImportErrorSummary): string {
	return (
		summary.code +
		(summary.constraint ? ` (${summary.constraint})` : "") +
		(summary.sqlState ? ` [SQLSTATE ${summary.sqlState}]` : "") +
		`: ${summary.message}`
	);
}

/**
 * Para los errores que se escapan del bucle de registros y acaban en el
 * manejador general del CLI (`Error: <message>`): un error de la base de
 * datos se cambia por otro con solo el resumen y sin `cause`. Los demás se
 * devuelven tal cual.
 */
export function withoutDbDetails(error: unknown): unknown {
	const described = describeDbError(error);
	return described ? new Error(formatImportError(described)) : error;
}
