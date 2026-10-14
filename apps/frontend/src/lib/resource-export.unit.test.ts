import { describe, expect, test } from "bun:test";
import {
	buildExportFilename,
	getDirectDownload,
	getElpxMediaItem,
	getResourceElpxFileUrl,
	isElpxFilename,
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

	test("la descarga directa usa el ELPX y su tamaño aunque haya otros ficheros", () => {
		const direct = getDirectDownload([
			{
				id: "1",
				resourceId: "r1",
				type: "file",
				url: "/guia.pdf",
				filename: "guia.pdf",
				fileSize: 1000,
				isPrimary: 1,
			},
			{
				id: "2",
				resourceId: "r1",
				type: "file",
				url: "/proyecto.elpx",
				filename: "proyecto.elpx",
				fileSize: 2048,
				isPrimary: 0,
			},
		]);

		expect(direct?.label).toBe("ELPX");
		expect(direct?.file.url).toBe("/proyecto.elpx");
		expect(direct?.file.fileSize).toBe(2048);
	});

	test("sin ELPX, la descarga directa se etiqueta con la extensión real", () => {
		const pdf = {
			id: "1",
			resourceId: "r1",
			type: "file",
			url: "/guia.pdf",
			filename: "Guía final.PDF",
			fileSize: 1000,
			isPrimary: 1,
		};

		expect(getDirectDownload([pdf])).toEqual({ file: pdf, label: "PDF" });
		expect(
			getDirectDownload([{ ...pdf, filename: "sin-extension" }])?.label,
		).toBe("");
		expect(getDirectDownload([])).toBeNull();
		expect(getDirectDownload(undefined)).toBeNull();
	});
});
