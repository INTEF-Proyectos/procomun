import { describe, expect, test } from "bun:test";
import {
	buildExportFilename,
	getElpxMediaItem,
	getResourceElpxFileUrl,
	isElpxFilename,
	listDownloadMenuOptions,
	RESOURCE_EXPORT_OPTIONS,
} from "./resource-export.ts";

describe("resource-export", () => {
	test("detecta extensiones .elpx y .elp", () => {
		expect(isElpxFilename("paquete.elpx")).toBe(true);
		expect(isElpxFilename("PAQUETE.ELP")).toBe(true);
		expect(isElpxFilename("guia.pdf")).toBe(false);
		expect(isElpxFilename(null)).toBe(false);
	});

	test("localiza el media item .elpx dentro del recurso", () => {
		const mediaItem = getElpxMediaItem([
			{
				id: "1",
				resourceId: "r1",
				type: "file",
				url: "/a.pdf",
				filename: "a.pdf",
				isPrimary: 0,
			},
			{
				id: "2",
				resourceId: "r1",
				type: "file",
				url: "/project.elpx",
				filename: "project.elpx",
				isPrimary: 1,
			},
		]);

		expect(mediaItem?.id).toBe("2");
	});

	test("prioriza elpxFileUrl explícita y usa mediaItems como fallback", () => {
		expect(
			getResourceElpxFileUrl({
				elpxFileUrl: "/api/v1/uploads/elpx/content",
				mediaItems: [
					{
						id: "1",
						resourceId: "r1",
						type: "file",
						url: "/project.elpx",
						filename: "project.elpx",
						isPrimary: 1,
					},
				],
			}),
		).toBe("/api/v1/uploads/elpx/content");

		expect(
			getResourceElpxFileUrl({
				elpxFileUrl: null,
				mediaItems: [
					{
						id: "1",
						resourceId: "r1",
						type: "file",
						url: "/project.elpx",
						filename: "project.elpx",
						isPrimary: 1,
					},
				],
			}),
		).toBe("/project.elpx");
	});

	test("expone los cuatro formatos esperados", () => {
		expect(RESOURCE_EXPORT_OPTIONS.map((option) => option.id)).toEqual([
			"scorm",
			"ims",
			"web",
			"epub",
		]);
		expect(
			RESOURCE_EXPORT_OPTIONS.map((option) => option.editorFormat),
		).toEqual(["scorm12", "ims", "html5", "epub3"]);
	});

	test("genera nombres de archivo con sufijo de formato", () => {
		expect(buildExportFilename("Mi Recurso Pedagógico", "scorm")).toBe(
			"mi-recurso-pedagogico_scorm.zip",
		);
		expect(buildExportFilename("Mi Recurso Pedagógico", "ims")).toBe(
			"mi-recurso-pedagogico_ims.zip",
		);
		expect(buildExportFilename("Mi Recurso Pedagógico", "web")).toBe(
			"mi-recurso-pedagogico_web.zip",
		);
		expect(buildExportFilename("Mi Recurso Pedagógico", "epub")).toBe(
			"mi-recurso-pedagogico.epub",
		);
	});

	test("usa 'recurso' como fallback cuando el título produce slug vacío", () => {
		expect(buildExportFilename("---", "scorm")).toBe("recurso_scorm.zip");
		expect(buildExportFilename("", "epub")).toBe("recurso.epub");
	});

	test("normaliza caracteres especiales y acentos", () => {
		expect(buildExportFilename("Éducación & Ciência!", "web")).toBe(
			"educacion-ciencia_web.zip",
		);
	});

	test("lista ELPX y las exportaciones, con IMS visible como LMS", () => {
		const options = listDownloadMenuOptions({
			hasDirectFile: true,
			hasExports: true,
		});

		expect(options.map((option) => option.id)).toEqual([
			"elpx",
			"scorm",
			"ims",
			"web",
			"epub",
		]);
		expect(options.find((option) => option.id === "ims")?.label).toBe("LMS");
		expect(options.map((option) => option.label)).toEqual([
			"ELPX",
			"SCORM",
			"LMS",
			"Web",
			"EPUB",
		]);
		expect(options.map((option) => option.label)).not.toContain("Ver online");
		expect(options.map((option) => option.label)).not.toContain("Ver Online");
	});

	test("omite ELPX cuando no hay fichero y deja fuera Ver online", () => {
		const options = listDownloadMenuOptions({
			hasDirectFile: false,
			hasExports: true,
		});

		expect(options.map((option) => option.id)).toEqual([
			"scorm",
			"ims",
			"web",
			"epub",
		]);
		expect(options.some((option) => option.id === "elpx")).toBe(false);
		expect(options.find((option) => option.id === "ims")?.label).toBe("LMS");
		expect(options.some((option) => /ver online/i.test(option.label))).toBe(
			false,
		);
	});

	test("no ofrece formatos si no hay fichero ni exportación", () => {
		expect(
			listDownloadMenuOptions({ hasDirectFile: false, hasExports: false }),
		).toEqual([]);
	});
});
