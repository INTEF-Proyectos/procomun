/**
 * Traduce el error de PATCH /api/admin/resources/:id/status a lo que pinta el
 * editor (issue #408): un error por campo y un mensaje que nombra todos los
 * que faltan, porque no todos los campos tienen hueco para su error.
 */
export interface StatusChangeFeedback {
	message: string;
	fieldErrors: Record<string, string>;
}

interface StatusChangeErrorBody {
	error?: unknown;
	details?: unknown;
}

const GENERIC_MESSAGE = "Error al cambiar el estado";

export function statusChangeFeedback(error: unknown): StatusChangeFeedback {
	const body = (
		error && typeof error === "object" ? error : {}
	) as StatusChangeErrorBody;
	const fieldErrors: Record<string, string> = {};
	if (Array.isArray(body.details)) {
		for (const detail of body.details) {
			if (
				detail &&
				typeof detail.field === "string" &&
				typeof detail.message === "string"
			) {
				fieldErrors[detail.field] = detail.message;
			}
		}
	}
	const messages = Object.values(fieldErrors);
	if (messages.length > 0) {
		return {
			message: `No se puede cambiar el estado: ${messages.join(". ")}.`,
			fieldErrors,
		};
	}
	const serverMessage =
		typeof body.error === "string" && !(error instanceof Error)
			? body.error
			: null;
	return { message: serverMessage ?? GENERIC_MESSAGE, fieldErrors };
}
