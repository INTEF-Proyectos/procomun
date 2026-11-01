import { describe, expect, test } from "bun:test";
import {
	buildUploadPublicUrl,
	buildUploadStorageKey,
	canManageResourceUpload,
	contentDisposition,
	extractFileExtension,
	getUploadConfig,
	sanitizeFilename,
	validateUploadCandidate,
} from "./config.ts";

describe("upload config helpers", () => {
	test("usa defaults conservadores cuando no hay env", () => {
		const config = getUploadConfig({});
		expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024 * 1024);
		expect(config.maxFilesPerBatch).toBe(20);
		expect(config.maxConcurrentPerUser).toBe(3);
		expect(config.maxTotalBytesPerUser).toBe(50 * 1024 * 1024 * 1024);
		expect(config.allowedExtensions.includes(".pdf")).toBe(true);
		expect(
			getUploadConfig({ UPLOAD_MAX_TOTAL_BYTES_PER_USER: "2048" })
				.maxTotalBytesPerUser,
		).toBe(2048);
	});

	test("sanitiza nombres de archivo para storage", () => {
		expect(sanitizeFilename("Vídeo final 2026!!.mp4")).toBe(
			"Video-final-2026-.mp4",
		);
		expect(extractFileExtension("paquete.SCORM")).toBe(".scorm");
	});

	test("valida extensión, mime y tamaño", () => {
		const config = getUploadConfig({});
		expect(
			validateUploadCandidate(config, {
				filename: "video.mp4",
				mimeType: "video/mp4",
				fileSize: 1024,
			}).ok,
		).toBe(true);
		expect(
			validateUploadCandidate(config, {
				filename: "malware.exe",
				mimeType: "application/octet-stream",
				fileSize: 1024,
			}).ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, {
				filename: "sin-extension",
				mimeType: "video/mp4",
				fileSize: 1024,
			}).ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, {
				filename: "video.mp4",
				mimeType: "",
				fileSize: 1024,
			}).ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, { filename: "video.mp4", fileSize: 1024 })
				.ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, {
				filename: "video.mp4",
				mimeType: "video/mp4",
				fileSize: null,
			}).ok,
		).toBe(true);
		expect(
			validateUploadCandidate(config, {
				filename: "dataset.csv",
				mimeType: "text/csv",
				fileSize: config.maxFileSizeBytes + 1,
			}).ok,
		).toBe(false);
	});

	test("rechaza nombres con separadores de ruta o salto de directorio (CAND-001)", () => {
		const config = getUploadConfig({});
		const peligrosos = [
			"../owned.pdf",
			"..\\owned.pdf",
			"sub/owned.pdf",
			"sub\\owned.pdf",
			"/var/www/shell.pdf",
			"C:\\Windows\\evil.pdf",
		];
		for (const filename of peligrosos) {
			const result = validateUploadCandidate(config, {
				filename,
				mimeType: "application/pdf",
				fileSize: 12,
			});
			expect(result.ok).toBe(false);
		}
	});

	test("rechaza referencias de directorio puras y caracteres de control", () => {
		const config = getUploadConfig({});
		expect(
			validateUploadCandidate(config, {
				filename: ".",
				mimeType: "application/pdf",
				fileSize: 12,
			}).ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, {
				filename: "..",
				mimeType: "application/pdf",
				fileSize: 12,
			}).ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, {
				filename: `doc${String.fromCharCode(0)}.pdf`,
				mimeType: "application/pdf",
				fileSize: 12,
			}).ok,
		).toBe(false);
		expect(
			validateUploadCandidate(config, {
				filename: `doc${String.fromCharCode(31)}.pdf`,
				mimeType: "application/pdf",
				fileSize: 12,
			}).ok,
		).toBe(false);
	});

	test("acepta nombres legítimos con puntos internos o acentos", () => {
		const config = getUploadConfig({});
		expect(
			validateUploadCandidate(config, {
				filename: "informe.final.pdf",
				mimeType: "application/pdf",
				fileSize: 12,
			}).ok,
		).toBe(true);
		expect(
			validateUploadCandidate(config, {
				filename: "Vídeo final.mp4",
				mimeType: "video/mp4",
				fileSize: 12,
			}).ok,
		).toBe(true);
	});

	test("aplica permisos de upload por rol", () => {
		const resource = { createdBy: "author-1", assignedCuratorId: "curator-1" };
		expect(
			canManageResourceUpload({ id: "admin-1", role: "admin" }, resource),
		).toBe(true);
		expect(
			canManageResourceUpload({ id: "curator-1", role: "curator" }, resource),
		).toBe(true);
		expect(
			canManageResourceUpload({ id: "author-1", role: "author" }, resource),
		).toBe(true);
		expect(
			canManageResourceUpload({ id: "author-1", role: "editor" }, resource),
		).toBe(true);
		expect(
			canManageResourceUpload({ id: "editor-1", role: "editor" }, resource),
		).toBe(false);
		expect(
			canManageResourceUpload({ id: "reader-1", role: "reader" }, resource),
		).toBe(false);
	});

	test("el curator asignado no sube a un borrador ajeno (#460)", () => {
		const curator = { id: "curator-1", role: "curator" };
		expect(
			canManageResourceUpload(curator, {
				createdBy: "author-1",
				assignedCuratorId: "curator-1",
				editorialStatus: "draft",
			}),
		).toBe(false);
		expect(
			canManageResourceUpload(curator, {
				createdBy: "author-1",
				assignedCuratorId: "curator-1",
				editorialStatus: "published",
			}),
		).toBe(true);
		expect(
			canManageResourceUpload(curator, {
				createdBy: "curator-1",
				assignedCuratorId: null,
				editorialStatus: "draft",
			}),
		).toBe(true);
	});

	test("genera claves de storage y urls públicas estables", () => {
		expect(buildUploadStorageKey("res-1", "upload-1", "Vídeo final.mp4")).toBe(
			"resource/res-1/upload-1/Video-final.mp4",
		);
		expect(buildUploadPublicUrl("upload-1")).toBe(
			"/api/v1/uploads/upload-1/content",
		);
	});

	test("contentDisposition escapa comillas y neutraliza CR/LF en el nombre", () => {
		// Un nombre con comilla no debe romper la quoted-string: queda escapada.
		const header = contentDisposition("attachment", 'a";x=y.pdf');
		expect(header).toContain('filename="a\\";x=y.pdf"');
		expect(header.startsWith("attachment; ")).toBe(true);

		// Las barras invertidas también se escapan.
		expect(contentDisposition("inline", "a\\b.pdf")).toContain(
			'filename="a\\\\b.pdf"',
		);

		// CR/LF se neutralizan en la parte ASCII (sin response splitting).
		const injected = contentDisposition(
			"attachment",
			`evil\r\nSet-Cookie: x=1.pdf`,
		);
		expect(injected).not.toContain("\r");
		expect(injected).not.toContain("\n");

		// Los nombres normales no se alteran.
		expect(contentDisposition("attachment", "informe.pdf")).toContain(
			'filename="informe.pdf"',
		);
	});
});
