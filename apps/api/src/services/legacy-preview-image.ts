/**
 * Copia la imagen `preview` del Procomún antiguo a nuestro almacenamiento
 * (#409), para no enlazarla en caliente desde ode.educacion.es.
 *
 * Solo descarga de ese host (también al seguir redirecciones), corta en
 * `maxBytes` y decide el tipo por los primeros bytes, no por la cabecera ni
 * la extensión: un HTML o un SVG nunca se guarda como miniatura.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_IMAGE_HOSTS = ["ode.educacion.es"] as const;
export const MAX_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/** Nombre de fichero servido: sha256 del contenido y extensión del tipo real. */
export const THUMBNAIL_FILE_RE = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
export const THUMBNAIL_PUBLIC_PREFIX = "/api/v1/thumbnails/";

export const THUMBNAIL_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

export type CopyPreviewResult =
	| { ok: true; url: string }
	/** `retryable`: fallo pasajero (red, 5xx, 429); repetir puede funcionar. */
	| { ok: false; reason: string; retryable: boolean };

const fail = (reason: string, retryable = false): CopyPreviewResult => ({
	ok: false,
	reason,
	retryable,
});

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

export function thumbnailPath(storageDir: string, file: string): string {
	return path.join(storageDir, "thumbnails", file);
}

export function isAllowedPreviewImageUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "https:" || url.protocol === "http:") &&
			(PREVIEW_IMAGE_HOSTS as readonly string[]).includes(
				url.hostname.toLowerCase(),
			)
		);
	} catch {
		return false;
	}
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
	return signature.every((byte, i) => bytes[offset + i] === byte);
}

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

export function detectImageType(bytes: Uint8Array): { ext: string } | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return { ext: "png" };
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg" };
	if (
		startsWith(bytes, ascii("GIF87a")) ||
		startsWith(bytes, ascii("GIF89a"))
	) {
		return { ext: "gif" };
	}
	if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
		return { ext: "webp" };
	}
	return null;
}

async function readCapped(
	response: Response,
	maxBytes: number,
): Promise<Uint8Array | null> {
	const declared = Number(response.headers.get("Content-Length"));
	if (Number.isFinite(declared) && declared > maxBytes) return null;
	if (!response.body) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function copyLegacyPreviewImage(
	sourceUrl: string,
	options: {
		storageDir: string;
		fetch?: typeof fetch;
		maxBytes?: number;
		timeoutMs?: number;
	},
): Promise<CopyPreviewResult> {
	if (!isAllowedPreviewImageUrl(sourceUrl)) {
		return fail("host no permitido");
	}
	const fetchFn = options.fetch ?? fetch;
	const maxBytes = options.maxBytes ?? MAX_PREVIEW_IMAGE_BYTES;

	let url = sourceUrl;
	let response: Response | null = null;
	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			response = await fetchFn(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
			});
			if (response.status < 300 || response.status >= 400) break;
			const location = response.headers.get("Location");
			if (!location) return fail(`HTTP ${response.status}`);
			url = new URL(location, url).href;
			if (!isAllowedPreviewImageUrl(url)) {
				return fail("redirección a un host no permitido");
			}
			response = null;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return fail(`error de red (${message})`, true);
	}
	if (!response) return fail("demasiadas redirecciones");
	if (!response.ok) {
		return fail(`HTTP ${response.status}`, isRetryableStatus(response.status));
	}

	let bytes: Uint8Array | null;
	try {
		bytes = await readCapped(response, maxBytes);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return fail(`error de red (${message})`, true);
	}
	if (!bytes) return fail(`la imagen supera ${maxBytes} bytes`);
	const stored = await storeThumbnailBytes(options.storageDir, bytes);
	if (!stored) {
		return fail("el contenido no es una imagen PNG, JPEG, GIF o WebP");
	}
	return { ok: true, url: stored.url };
}

/**
 * Guarda una miniatura en `storageDir/thumbnails/` con el sha256 del contenido
 * como nombre. `null` si los bytes no son PNG, JPEG, GIF ni WebP. Se escribe
 * en un temporal y se renombra: una escritura a medias nunca queda con el
 * nombre definitivo, que la ruta sirve como inmutable.
 */
export async function storeThumbnailBytes(
	storageDir: string,
	bytes: Uint8Array,
): Promise<{ file: string; url: string } | null> {
	const type = detectImageType(bytes);
	if (!type) return null;
	const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	const file = `${hash}.${type.ext}`;
	const target = thumbnailPath(storageDir, file);
	const temp = `${target}.${randomUUID()}.tmp`;
	await mkdir(path.dirname(target), { recursive: true });
	try {
		await writeFile(temp, bytes);
		await rename(temp, target);
	} catch (err) {
		await rm(temp, { force: true });
		throw err;
	}
	return { file, url: `${THUMBNAIL_PUBLIC_PREFIX}${file}` };
}
