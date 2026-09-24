import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export type UploadUser = {
	id: string;
	role?: string | null;
	email?: string | null;
	name?: string | null;
};

export type UploadTargetResource = {
	id?: string;
	createdBy?: string | null;
	assignedCuratorId?: string | null;
};

const DEFAULT_ALLOWED_EXTENSIONS = [
	".pdf",
	".doc",
	".docx",
	".ppt",
	".pptx",
	".zip",
	".scorm",
	".elp",
	".elpx",
	".mp4",
	".mp3",
	".wav",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".csv",
	".json",
];

const DEFAULT_ALLOWED_MIME_TYPES = [
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/octet-stream",
	"application/zip",
	"application/x-zip-compressed",
	"application/json",
	"text/csv",
	"video/mp4",
	"audio/mpeg",
	"audio/wav",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
];

function parseNumberEnv(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsvEnv(value: string | undefined, fallback: string[]) {
	const items = value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return items?.length ? items : fallback;
}

export function getUploadConfig(
	env: Record<string, string | undefined> = process.env,
) {
	return {
		maxFileSizeBytes: parseNumberEnv(
			env.UPLOAD_MAX_FILE_SIZE_BYTES,
			10 * 1024 * 1024 * 1024,
		),
		maxFilesPerBatch: parseNumberEnv(env.UPLOAD_MAX_FILES_PER_BATCH, 20),
		maxConcurrentPerUser: parseNumberEnv(env.UPLOAD_MAX_CONCURRENT_PER_USER, 3),
		maxTotalBytesPerUser: parseNumberEnv(
			env.UPLOAD_MAX_TOTAL_BYTES_PER_USER,
			50 * 1024 * 1024 * 1024,
		),
		chunkSizeBytes: parseNumberEnv(
			env.UPLOAD_CHUNK_SIZE_BYTES,
			5 * 1024 * 1024,
		),
		sessionTtlMs: parseNumberEnv(
			env.UPLOAD_SESSION_TTL_MS,
			24 * 60 * 60 * 1000,
		),
		allowedMimeTypes: parseCsvEnv(
			env.UPLOAD_ALLOWED_MIME_TYPES,
			DEFAULT_ALLOWED_MIME_TYPES,
		),
		allowedExtensions: parseCsvEnv(
			env.UPLOAD_ALLOWED_EXTENSIONS,
			DEFAULT_ALLOWED_EXTENSIONS,
		),
		storageDir:
			env.UPLOAD_STORAGE_DIR ??
			path.join(import.meta.dir, "../../../../local-data/uploads"),
	};
}

export function sanitizeFilename(filename: string) {
	return (
		filename
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 180) || "archivo"
	);
}

export function extractFileExtension(filename: string) {
	return path.extname(filename).toLowerCase();
}

// Caracteres de control (incluido NUL) que nunca deben aparecer en un nombre de archivo.
// Detección por code point (0x00-0x1F y 0x7F) para que el conjunto quede explícito.
function hasControlChars(value: string): boolean {
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return false;
}

/**
 * Rechaza nombres de archivo que podrían provocar path traversal o escritura
 * fuera del directorio previsto (CWE-22/CWE-73). Devuelve el mensaje de error
 * en español si el nombre es peligroso, o `null` si es seguro.
 *
 * Se aplica en la frontera de entrada (antes de persistir el nombre) y es la
 * primera línea de defensa; la generación de paquetes añade defensa en
 * profundidad reduciendo el nombre a un basename y comprobando el confinamiento.
 */
export function rejectUnsafeFilename(filename: string): string | null {
	if (filename === "." || filename === "..") {
		return "El nombre no puede ser una referencia de directorio (. o ..)";
	}
	if (hasControlChars(filename)) {
		return "El nombre contiene caracteres de control no permitidos";
	}
	if (filename.includes("/") || filename.includes("\\")) {
		return "El nombre no puede contener separadores de ruta (/ o \\)";
	}
	if (/^[a-zA-Z]:/.test(filename)) {
		return "El nombre no puede contener un prefijo de unidad (C:, D:, …)";
	}
	return null;
}

export function canManageResourceUpload(
	user: UploadUser,
	resource: UploadTargetResource,
) {
	const role = user.role ?? "reader";
	if (role === "admin") return true;
	if (role === "curator") {
		return (
			resource.createdBy === user.id || resource.assignedCuratorId === user.id
		);
	}
	if (role === "author" || role === "editor") {
		return resource.createdBy === user.id;
	}
	return false;
}

export function validateUploadCandidate(
	config: ReturnType<typeof getUploadConfig>,
	data: {
		filename: string;
		mimeType?: string | null;
		fileSize?: number | null;
	},
) {
	if (!data.filename.trim()) {
		return { ok: false, error: "El nombre del archivo es obligatorio" };
	}

	const unsafe = rejectUnsafeFilename(data.filename);
	if (unsafe) {
		return { ok: false, error: unsafe };
	}

	const extension = extractFileExtension(data.filename);
	if (!extension) {
		return {
			ok: false,
			error: "El archivo debe incluir una extensión permitida",
		};
	}
	if (!config.allowedExtensions.includes(extension)) {
		return { ok: false, error: `Extensión no permitida: ${extension}` };
	}

	if (!data.mimeType?.trim()) {
		return { ok: false, error: "El tipo MIME es obligatorio" };
	}
	if (!config.allowedMimeTypes.includes(data.mimeType)) {
		return { ok: false, error: `Tipo MIME no permitido: ${data.mimeType}` };
	}

	if (data.fileSize != null && data.fileSize > config.maxFileSizeBytes) {
		return { ok: false, error: "El archivo supera el límite configurado" };
	}

	return { ok: true, error: null };
}

export function buildUploadStorageKey(
	resourceId: string,
	uploadId: string,
	filename: string,
) {
	return path.posix.join(
		"resource",
		resourceId,
		uploadId,
		sanitizeFilename(filename),
	);
}

export function buildUploadPublicUrl(uploadId: string) {
	return `/api/v1/uploads/${uploadId}/content`;
}

export function resolveStoredFilePath(
	config: ReturnType<typeof getUploadConfig>,
	uploadId: string,
) {
	return path.join(config.storageDir, uploadId);
}

export async function ensureUploadStorageDir(
	config: ReturnType<typeof getUploadConfig>,
) {
	await mkdir(config.storageDir, { recursive: true });
}

/**
 * Builds a safe Content-Disposition header value that handles non-ASCII filenames.
 * Uses RFC 5987 encoding so browsers receive the original UTF-8 name.
 */
export function contentDisposition(
	disposition: "attachment" | "inline",
	filename: string,
): string {
	// Reemplaza lo no imprimible (neutraliza CR/LF) y escapa comillas y barras
	// invertidas según el quoted-pair de RFC 6266, para que un nombre con `"` no
	// rompa la quoted-string e inyecte parámetros adicionales en la cabecera.
	const ascii = filename
		.replace(/[^\x20-\x7e]/g, "_")
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"');
	const encoded = encodeURIComponent(filename);
	return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function computeFileSha256(filePath: string) {
	return new Promise<string>((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}
