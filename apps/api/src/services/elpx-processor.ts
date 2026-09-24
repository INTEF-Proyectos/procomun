import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ElpxMetadata } from "@procomun/db/elpx-metadata";
import { parseContentXml } from "@procomun/db/elpx-metadata";
import {
	DEFAULT_ELPX_EXTRACT_LIMITS,
	type ElpxExtractLimits,
	safeExtractElpx,
} from "./elpx-safe-extract.ts";

export type { ElpxMetadata };

export type ElpxProcessResult = {
	hash: string;
	extractPath: string;
	hasPreview: boolean;
	metadata: ElpxMetadata;
};

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function validateElpxFile(filePath: string): Promise<void> {
	if (!(await fileExists(filePath))) {
		throw new Error("El archivo no existe");
	}

	// Validate ZIP structure by scanning the raw bytes for entry names.
	// We avoid subprocess calls (unzip) because Bun's test runner captures stdout.
	let zipBytes: Buffer;
	try {
		zipBytes = await readFile(filePath);
	} catch {
		throw new Error("No se puede leer el archivo");
	}

	// Quick ZIP signature check (PK\x03\x04)
	if (zipBytes.length < 4 || zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) {
		throw new Error("El archivo no es un ZIP válido");
	}

	const zipText = zipBytes.toString("latin1");
	const hasContentV3 = zipText.includes("contentv3.xml");
	const hasContent = zipText.includes("content.xml");

	if (hasContentV3 && !hasContent) {
		throw new Error(
			"Este archivo fue creado con una versión antigua de eXeLearning. Ábralo con eXeLearning 3.x y guárdelo de nuevo.",
		);
	}

	if (!hasContent) {
		throw new Error(
			"El archivo no es un .elpx válido (no contiene content.xml)",
		);
	}
}

export async function parseElpxMetadata(
	filePath: string,
	limits: ElpxExtractLimits = DEFAULT_ELPX_EXTRACT_LIMITS,
): Promise<ElpxMetadata> {
	await validateElpxFile(filePath);

	// La extracción real la hace `unzip` más abajo; content.xml se lee del
	// directorio temporal.
	const tempDir = path.join(
		(await import("node:os")).tmpdir(),
		`elpx-parse-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });

	try {
		await safeExtractElpx(filePath, tempDir, limits);

		const contentPath = path.join(tempDir, "content.xml");
		if (!(await fileExists(contentPath))) {
			throw new Error(
				"El archivo no es un .elpx válido (no contiene content.xml)",
			);
		}

		const xml = await Bun.file(contentPath).text();
		return parseContentXml(xml);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

export function buildElpxPath(baseDir: string, hash: string): string {
	return path.join(baseDir, "elpx", hash);
}

export async function processElpxUpload(
	filePath: string,
	baseDir: string,
	opts?: { hash?: string },
): Promise<ElpxProcessResult> {
	const metadata = await parseElpxMetadata(filePath);

	// Use provided hash or generate a unique one
	const hash = opts?.hash ?? crypto.randomUUID();

	const extractPath = buildElpxPath(baseDir, hash);
	await mkdir(extractPath, { recursive: true });

	// Extracción segura: valida nombres (zip slip), rechaza symlinks, aplica
	// límites anti zip-bomb y verifica contención post-extracción (ADR-0026).
	await safeExtractElpx(filePath, extractPath);

	const hasPreview = await fileExists(path.join(extractPath, "index.html"));

	return { hash, extractPath, hasPreview, metadata };
}

export async function removeElpxExtraction(extractPath: string): Promise<void> {
	await rm(extractPath, { recursive: true, force: true });
}
