/**
 * Client-side .elpx export service using eXeLearning's SharedExporters bundle.
 *
 * Loads the exporters.bundle.js (IIFE) from the editor static assets lazily,
 * then uses SharedExporters.quickExport() to convert .elpx content to
 * SCORM 1.2, SCORM 2004, IMS CP, HTML5, HTML5 single-page, or EPUB3.
 *
 * ADR-0024: All exports run entirely in the browser — no server processing needed.
 */

// --- Types ---

/** Supported export format identifiers matching eXeLearning's ExportFormat enum */
export type ElpxExportFormat =
	| "scorm12"
	| "scorm2004"
	| "ims"
	| "html5"
	| "html5-sp"
	| "epub3";

/** Result from a successful export */
export interface ElpxExportResult {
	success: true;
	data: Uint8Array;
	filename: string;
	mimeType: string;
}

/** Result from a failed export */
export interface ElpxExportError {
	success: false;
	error: string;
}

export type ExportResult = ElpxExportResult | ElpxExportError;

/** Metadata about a supported export format */
export interface ExportFormatInfo {
	id: ElpxExportFormat;
	label: string;
	extension: string;
	mimeType: string;
	description: string;
}

/** All supported export formats with metadata */
export const EXPORT_FORMATS: ExportFormatInfo[] = [
	{
		id: "scorm12",
		label: "SCORM 1.2",
		extension: ".zip",
		mimeType: "application/zip",
		description: "Paquete SCORM 1.2 compatible con Moodle, Blackboard y Canvas",
	},
	{
		id: "scorm2004",
		label: "SCORM 2004",
		extension: ".zip",
		mimeType: "application/zip",
		description: "Paquete SCORM 2004 con seguimiento avanzado de progreso",
	},
	{
		id: "ims",
		label: "IMS Content Package",
		extension: ".zip",
		mimeType: "application/zip",
		description: "Paquete IMS CP para interoperabilidad con plataformas LMS",
	},
	{
		id: "html5",
		label: "Web (HTML5)",
		extension: ".zip",
		mimeType: "application/zip",
		description: "Sitio HTML5 multi-página para publicación en servidor o CDN",
	},
	{
		id: "html5-sp",
		label: "Web (página única)",
		extension: ".zip",
		mimeType: "application/zip",
		description: "Página HTML5 única con navegación por anclas",
	},
	{
		id: "epub3",
		label: "EPUB 3",
		extension: ".epub",
		mimeType: "application/epub+zip",
		description: "Libro electrónico EPUB3 para lectura offline y accesibilidad",
	},
];

// --- SharedExporters type declarations ---

interface SharedExportersAPI {
	quickExport(
		format: string,
		documentManager: unknown,
		assetCache: unknown | null,
		resourceFetcher: unknown | null,
		options?: Record<string, unknown>,
		assetManager?: unknown | null,
	): Promise<{ success: boolean; data?: Uint8Array; filename?: string; error?: string }>;
	createExporter(
		format: string,
		documentManager: unknown,
		assetCache: unknown | null,
		resourceFetcher: unknown | null,
		assetManager?: unknown | null,
	): unknown;
}

declare global {
	interface Window {
		SharedExporters?: SharedExportersAPI;
	}
}

// --- Lazy loading ---

const BUNDLE_PATH = "/api/v1/exelearning-editor/app/yjs/exporters.bundle.js";

let bundleLoadPromise: Promise<SharedExportersAPI> | null = null;

/**
 * Load the SharedExporters bundle lazily. Returns the API once available.
 * Caches the result so subsequent calls are instant.
 */
export function loadExportersBundle(bundleSrc?: string): Promise<SharedExportersAPI> {
	if (bundleLoadPromise) return bundleLoadPromise;

	bundleLoadPromise = new Promise<SharedExportersAPI>((resolve, reject) => {
		// Check if already loaded (e.g. by the editor iframe)
		if (window.SharedExporters?.quickExport) {
			resolve(window.SharedExporters);
			return;
		}

		const script = document.createElement("script");
		script.src = bundleSrc || BUNDLE_PATH;
		script.async = true;

		script.onload = () => {
			if (window.SharedExporters?.quickExport) {
				resolve(window.SharedExporters);
			} else {
				bundleLoadPromise = null;
				reject(new Error("SharedExporters no disponible tras cargar el bundle"));
			}
		};

		script.onerror = () => {
			bundleLoadPromise = null;
			reject(new Error(`No se pudo cargar el bundle de exportación: ${script.src}`));
		};

		document.head.appendChild(script);
	});

	return bundleLoadPromise;
}

/**
 * Reset the bundle loading state. Useful for testing.
 */
export function resetBundleLoader(): void {
	bundleLoadPromise = null;
}

// --- Document Adapter ---

/**
 * Minimal adapter that satisfies YjsDocumentManagerLike interface
 * using pre-parsed content.xml metadata and navigation structure.
 */
export interface ElpxDocumentData {
	/** Parsed metadata from content.xml */
	metadata: Record<string, unknown>;
	/** Navigation/page structure from content.xml */
	navigation: Record<string, unknown>;
	/** Project ID (resource ID or elpx hash) */
	projectId: string;
}

/**
 * Creates a document manager adapter compatible with SharedExporters.
 * Translates Procomún's extracted .elpx data into the interface expected by exporters.
 */
export function createDocumentAdapter(data: ElpxDocumentData): unknown {
	return {
		getMetadata: () => data.metadata,
		getNavigation: () => data.navigation,
		projectId: data.projectId,
	};
}

// --- Resource Fetcher (null-safe for standalone export) ---

/**
 * Creates a resource fetcher that returns files from the extracted .elpx content.
 * For theme/library files not present in the .elpx, returns empty Maps
 * (eXeLearning's exporters handle missing resources gracefully).
 */
export function createResourceFetcher(files: Map<string, Uint8Array>): unknown {
	const emptyMap = new Map<string, Blob>();

	const toBlob = (data: Uint8Array, type = "application/octet-stream") =>
		new Blob([data], { type });

	return {
		fetchTheme: async (_themeName: string): Promise<Map<string, Blob>> => {
			// Extract theme files from the .elpx content
			const themeFiles = new Map<string, Blob>();
			for (const [path, data] of files) {
				if (path.startsWith("css/") || path.startsWith("theme/")) {
					themeFiles.set(path, toBlob(data));
				}
			}
			return themeFiles.size > 0 ? themeFiles : emptyMap;
		},
		fetchIdevice: async (_type: string): Promise<Map<string, Blob>> => emptyMap,
		fetchBaseLibraries: async (): Promise<Map<string, Blob>> => {
			const libs = new Map<string, Blob>();
			for (const [path, data] of files) {
				if (path.startsWith("libs/") || path.startsWith("js/")) {
					libs.set(path, toBlob(data, "application/javascript"));
				}
			}
			return libs;
		},
		fetchScormFiles: async (): Promise<Map<string, Blob>> => emptyMap,
		fetchLibraryFiles: async (_paths: string[]): Promise<Map<string, Blob>> => emptyMap,
		fetchLibraryDirectory: async (_name: string): Promise<Map<string, Blob>> => emptyMap,
		fetchSchemas: async (_format: string): Promise<Map<string, Blob>> => emptyMap,
	};
}

// --- Asset Manager ---

/**
 * Creates an asset manager that serves project assets from the extracted .elpx files.
 */
export function createAssetManager(files: Map<string, Uint8Array>): unknown {
	const assets = Array.from(files.entries())
		.filter(([p]) => p.startsWith("content/") || p.startsWith("resources/"))
		.map(([path, data]) => ({
			id: path,
			path,
			data,
			size: data.byteLength,
		}));

	return {
		getProjectAssets: async () => assets,
		getAsset: async (assetId: string) => assets.find((a) => a.id === assetId) || null,
		resolveAssetURL: async (url: string) => {
			const matched = assets.find((a) => a.path === url || a.id === url);
			if (!matched) return null;
			return URL.createObjectURL(new Blob([matched.data]));
		},
	};
}

// --- Main Export Function ---

/**
 * Export a .elpx file to the specified format entirely in the browser.
 *
 * @param format - Target export format (scorm12, scorm2004, ims, html5, html5-sp, epub3)
 * @param elpxData - Raw bytes of the .elpx file
 * @param projectId - Resource/project identifier
 * @param bundleSrc - Optional override for the exporters bundle URL
 * @returns Export result with the generated file data or an error
 */
export async function exportElpx(
	format: ElpxExportFormat,
	elpxData: Uint8Array,
	projectId: string,
	bundleSrc?: string,
): Promise<ExportResult> {
	try {
		// 1. Load the exporters bundle
		const exporters = await loadExportersBundle(bundleSrc);

		// 2. Extract files from the .elpx ZIP
		const files = await extractElpxFiles(elpxData);

		// 3. Parse content.xml for metadata and navigation
		const contentXml = files.get("content.xml");
		if (!contentXml) {
			return { success: false, error: "El archivo .elpx no contiene content.xml" };
		}

		const parsedContent = parseContentXmlForExport(new TextDecoder().decode(contentXml));

		// 4. Create adapters
		const documentAdapter = createDocumentAdapter({
			metadata: parsedContent.metadata,
			navigation: parsedContent.navigation,
			projectId,
		});
		const resourceFetcher = createResourceFetcher(files);
		const assetManager = createAssetManager(files);

		// 5. Run the export
		const result = await exporters.quickExport(
			format,
			documentAdapter,
			null, // assetCache (legacy, not needed)
			resourceFetcher,
			{}, // options
			assetManager,
		);

		if (!result?.success || !result?.data) {
			return { success: false, error: result?.error || "La exportación falló sin mensaje de error" };
		}

		// 6. Determine output metadata
		const formatInfo = EXPORT_FORMATS.find((f) => f.id === format);
		const filename = result.filename || `export${formatInfo?.extension || ".zip"}`;
		const mimeType = formatInfo?.mimeType || "application/zip";

		return {
			success: true,
			data: result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data),
			filename,
			mimeType,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : "Error desconocido durante la exportación";
		return { success: false, error: message };
	}
}

// --- Download Helper ---

/**
 * Trigger a file download in the browser from export result data.
 */
export function downloadExportResult(result: ElpxExportResult): void {
	const blob = new Blob([result.data], { type: result.mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = result.filename;
	document.body.appendChild(a);
	a.click();
	// Clean up after a short delay to ensure download starts
	setTimeout(() => {
		URL.revokeObjectURL(url);
		a.remove();
	}, 1000);
}

/**
 * Full export-and-download flow: exports the .elpx and triggers a browser download.
 *
 * @param format - Target format
 * @param elpxUrl - URL to fetch the .elpx file from (e.g. /api/admin/uploads/:id/content)
 * @param projectId - Resource/project identifier
 * @returns The export result (success or error)
 */
export async function exportAndDownload(
	format: ElpxExportFormat,
	elpxUrl: string,
	projectId: string,
): Promise<ExportResult> {
	// Fetch the .elpx file
	const response = await fetch(elpxUrl);
	if (!response.ok) {
		return { success: false, error: `No se pudo descargar el archivo .elpx: ${response.status}` };
	}

	const elpxData = new Uint8Array(await response.arrayBuffer());
	const result = await exportElpx(format, elpxData, projectId);

	if (result.success) {
		downloadExportResult(result);
	}

	return result;
}

// --- Internal Helpers ---

/**
 * Extract all files from a ZIP buffer (simplified version for export adapter).
 * Uses the central directory for robust parsing.
 */
async function extractElpxFiles(data: Uint8Array): Promise<Map<string, Uint8Array>> {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const files = new Map<string, Uint8Array>();

	// Find EOCD
	let eocdOffset = -1;
	for (let i = data.length - 22; i >= 0 && i >= data.length - 65536; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) throw new Error("Archivo ZIP inválido");

	// Parse central directory
	const cdOffset = view.getUint32(eocdOffset + 16, true);
	const cdCount = view.getUint16(eocdOffset + 10, true);
	const dec = new TextDecoder();
	let pos = cdOffset;

	for (let i = 0; i < cdCount; i++) {
		if (view.getUint32(pos, true) !== 0x02014b50) break;
		const method = view.getUint16(pos + 10, true);
		const compressedSize = view.getUint32(pos + 20, true);
		const uncompressedSize = view.getUint32(pos + 24, true);
		const nameLen = view.getUint16(pos + 28, true);
		const extraLen = view.getUint16(pos + 30, true);
		const commentLen = view.getUint16(pos + 32, true);
		const localHeaderOffset = view.getUint32(pos + 42, true);
		const name = dec.decode(data.slice(pos + 46, pos + 46 + nameLen));

		pos += 46 + nameLen + extraLen + commentLen;

		// Skip directories, empty files, and path traversal
		if (name.endsWith("/") || uncompressedSize === 0 || name.includes("..")) continue;

		// Extract from local header
		const localNameLen = view.getUint16(localHeaderOffset + 26, true);
		const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
		const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
		const raw = data.slice(dataStart, dataStart + compressedSize);

		if (method === 0) {
			files.set(name, raw);
		} else if (method === 8) {
			files.set(name, await inflateRaw(raw));
		}
	}

	return files;
}

/** Decompress deflate-raw data using DecompressionStream */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream("deflate-raw");
	const writer = ds.writable.getWriter();
	writer.write(data);
	writer.close();
	const reader = ds.readable.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

/**
 * Parse content.xml from .elpx into metadata and navigation structures
 * compatible with SharedExporters' YjsDocumentManagerLike interface.
 */
export function parseContentXmlForExport(xmlString: string): {
	metadata: Record<string, unknown>;
	navigation: Record<string, unknown>;
} {
	// Extract metadata fields using regex (lightweight, no DOM parser needed)
	const getTag = (tag: string): string => {
		const match = xmlString.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
		return match?.[1]?.trim() || "";
	};

	const getAttr = (tag: string, attr: string): string => {
		const match = xmlString.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
		return match?.[1] || "";
	};

	const metadata: Record<string, unknown> = {
		title: getTag("title") || getTag("dc:title") || "Sin título",
		description: getTag("description") || getTag("dc:description") || "",
		author: getTag("creator") || getTag("dc:creator") || "",
		language: getTag("language") || getTag("dc:language") || "es",
		license: getTag("rights") || getTag("dc:rights") || "",
		subject: getTag("subject") || getTag("dc:subject") || "",
		theme: getAttr("style", "name") || getAttr("theme", "name") || "base",
	};

	// Parse navigation structure (pages/nodes)
	const pages: Array<Record<string, unknown>> = [];
	const nodeRegex = /<node\b[^>]*>/gi;
	let nodeMatch: RegExpExecArray | null;
	let pageIndex = 0;

	while ((nodeMatch = nodeRegex.exec(xmlString)) !== null) {
		const nodeStr = nodeMatch[0];
		const idMatch = nodeStr.match(/id="([^"]*)"/);
		const titleMatch = nodeStr.match(/title="([^"]*)"/);
		pages.push({
			id: idMatch?.[1] || `page-${pageIndex}`,
			title: titleMatch?.[1] || `Página ${pageIndex + 1}`,
			index: pageIndex,
		});
		pageIndex++;
	}

	const navigation: Record<string, unknown> = {
		pages,
		pageCount: pages.length || 1,
		structure: "linear",
	};

	return { metadata, navigation };
}

/**
 * Validate that a format string is a supported export format.
 */
export function isValidExportFormat(format: string): format is ElpxExportFormat {
	return EXPORT_FORMATS.some((f) => f.id === format);
}
