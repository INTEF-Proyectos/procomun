/**
 * Motor de miniaturas visto desde la API (#470, ADR-0046). El bucle solo
 * conoce esta interfaz; hoy la implementa el servicio `thumbnailer` por HTTP
 * y, si algún día se cambia de motor (Gotenberg), basta otro adaptador.
 */
import { detectImageType } from "../services/legacy-preview-image.ts";

export type RenderOutcome =
	| { kind: "image"; bytes: Uint8Array }
	/** Portada sin texto ni imágenes visibles. */
	| { kind: "empty" }
	/** `retryable`: repetir más tarde puede funcionar. */
	| { kind: "failed"; reason: string; retryable: boolean }
	/** El servicio no responde: no es culpa del paquete. */
	| { kind: "unavailable"; reason: string };

export interface ThumbnailRenderer {
	render(hash: string): Promise<RenderOutcome>;
	/** El servicio responde. Lo usa el bucle para saber que una caída terminó. */
	healthy?(): Promise<boolean>;
}

/** Cota de seguridad; el servicio ya apunta a 100 KB. */
export const MAX_RENDERED_BYTES = 512 * 1024;
const HEALTH_TIMEOUT_MS = 3_000;

async function readReason(response: Response): Promise<string | null> {
	try {
		const body = (await response.json()) as {
			status?: unknown;
			message?: unknown;
		};
		const message = typeof body.message === "string" ? body.message : null;
		const status = typeof body.status === "string" ? body.status : null;
		return [status, message].filter(Boolean).join(": ") || null;
	} catch {
		return null;
	}
}

async function readImage(response: Response): Promise<RenderOutcome> {
	const declared = Number(response.headers.get("Content-Length"));
	if (Number.isFinite(declared) && declared > MAX_RENDERED_BYTES) {
		await response.body?.cancel();
		return {
			kind: "failed",
			reason: `la miniatura supera ${MAX_RENDERED_BYTES} bytes`,
			retryable: false,
		};
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_RENDERED_BYTES) {
		return {
			kind: "failed",
			reason: `la miniatura supera ${MAX_RENDERED_BYTES} bytes`,
			retryable: false,
		};
	}
	if (!detectImageType(bytes)) {
		return {
			kind: "failed",
			reason: "la respuesta del servicio no es una imagen",
			retryable: false,
		};
	}
	return { kind: "image", bytes };
}

export function createHttpThumbnailRenderer(options: {
	baseUrl: string;
	timeoutMs: number;
	fetch?: typeof fetch;
}): ThumbnailRenderer & { healthy(): Promise<boolean> } {
	const fetchFn = options.fetch ?? fetch;
	const base = options.baseUrl.replace(/\/+$/, "");

	async function healthy(): Promise<boolean> {
		try {
			const response = await fetchFn(`${base}/health`, {
				signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
			});
			await response.body?.cancel();
			return response.ok;
		} catch {
			return false;
		}
	}

	async function render(hash: string): Promise<RenderOutcome> {
		let response: Response;
		try {
			response = await fetchFn(`${base}/render`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ hash }),
				signal: AbortSignal.timeout(options.timeoutMs),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Si el servicio sigue vivo, lo que falló fue esta captura (p. ej.
			// el navegador se cayó con este paquete) y cuenta como intento.
			if (await healthy()) {
				return {
					kind: "failed",
					reason: `la petición al servicio falló (${message})`,
					retryable: true,
				};
			}
			return {
				kind: "unavailable",
				reason: `servicio no disponible (${message})`,
			};
		}

		if (response.ok) return readImage(response);
		const reason = (await readReason(response)) ?? `HTTP ${response.status}`;
		switch (response.status) {
			case 422:
				return { kind: "empty" };
			case 400:
			case 404:
				return { kind: "failed", reason, retryable: false };
			case 503:
				return { kind: "unavailable", reason };
			default:
				return { kind: "failed", reason, retryable: true };
		}
	}

	return { render, healthy };
}
