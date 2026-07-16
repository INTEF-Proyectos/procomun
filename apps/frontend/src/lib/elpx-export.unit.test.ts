import { describe, expect, test } from "bun:test";
import {
	createAssetManager,
	createDocumentAdapter,
	createResourceFetcher,
	EXPORT_FORMATS,
	isValidExportFormat,
	parseContentXmlForExport,
	resetBundleLoader,
} from "./elpx-export.ts";

describe("EXPORT_FORMATS", () => {
	test("contiene los 6 formatos soportados", () => {
		expect(EXPORT_FORMATS).toHaveLength(6);
		const ids = EXPORT_FORMATS.map((f) => f.id);
		expect(ids).toContain("scorm12");
		expect(ids).toContain("scorm2004");
		expect(ids).toContain("ims");
		expect(ids).toContain("html5");
		expect(ids).toContain("html5-sp");
		expect(ids).toContain("epub3");
	});

	test("cada formato tiene label, extension, mimeType y description", () => {
		for (const format of EXPORT_FORMATS) {
			expect(format.label.length).toBeGreaterThan(0);
			expect(format.extension).toMatch(/^\./);
			expect(format.mimeType).toContain("/");
			expect(format.description.length).toBeGreaterThan(0);
		}
	});

	test("EPUB3 tiene mimeType epub+zip", () => {
		const epub = EXPORT_FORMATS.find((f) => f.id === "epub3");
		expect(epub?.mimeType).toBe("application/epub+zip");
		expect(epub?.extension).toBe(".epub");
	});
});

describe("isValidExportFormat", () => {
	test("acepta formatos válidos", () => {
		expect(isValidExportFormat("scorm12")).toBe(true);
		expect(isValidExportFormat("scorm2004")).toBe(true);
		expect(isValidExportFormat("ims")).toBe(true);
		expect(isValidExportFormat("html5")).toBe(true);
		expect(isValidExportFormat("html5-sp")).toBe(true);
		expect(isValidExportFormat("epub3")).toBe(true);
	});

	test("rechaza formatos inválidos", () => {
		expect(isValidExportFormat("pdf")).toBe(false);
		expect(isValidExportFormat("docx")).toBe(false);
		expect(isValidExportFormat("")).toBe(false);
		expect(isValidExportFormat("SCORM12")).toBe(false); // case sensitive
	});
});

describe("parseContentXmlForExport", () => {
	const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <title>Mi recurso educativo</title>
  <dc:description>Descripción del recurso</dc:description>
  <dc:creator>Autor Test</dc:creator>
  <dc:language>es</dc:language>
  <dc:rights>CC BY-SA 4.0</dc:rights>
  <dc:subject>Matemáticas</dc:subject>
  <style name="academy"/>
  <node id="page1" title="Introducción"/>
  <node id="page2" title="Desarrollo"/>
  <node id="page3" title="Conclusión"/>
</project>`;

	test("extrae metadatos del content.xml", () => {
		const { metadata } = parseContentXmlForExport(sampleXml);
		expect(metadata.title).toBe("Mi recurso educativo");
		expect(metadata.description).toBe("Descripción del recurso");
		expect(metadata.author).toBe("Autor Test");
		expect(metadata.language).toBe("es");
		expect(metadata.license).toBe("CC BY-SA 4.0");
		expect(metadata.subject).toBe("Matemáticas");
		expect(metadata.theme).toBe("academy");
	});

	test("extrae estructura de navegación (nodos)", () => {
		const { navigation } = parseContentXmlForExport(sampleXml);
		expect(navigation.pageCount).toBe(3);
		expect(navigation.structure).toBe("linear");
		const pages = navigation.pages as Array<{
			id: string;
			title: string;
			index: number;
		}>;
		expect(pages).toHaveLength(3);
		expect(pages[0]).toEqual({ id: "page1", title: "Introducción", index: 0 });
		expect(pages[1]).toEqual({ id: "page2", title: "Desarrollo", index: 1 });
		expect(pages[2]).toEqual({ id: "page3", title: "Conclusión", index: 2 });
	});

	test("maneja XML sin metadatos con valores por defecto", () => {
		const { metadata, navigation } = parseContentXmlForExport(
			"<project></project>",
		);
		expect(metadata.title).toBe("Sin título");
		expect(metadata.description).toBe("");
		expect(metadata.author).toBe("");
		expect(metadata.language).toBe("es");
		// pageCount defaults to 1 minimum (every project has at least one implicit page)
		expect(navigation.pageCount).toBe(1);
		const pages = navigation.pages as Array<unknown>;
		expect(pages).toHaveLength(0);
	});

	test("parsea dc:title como fallback de title", () => {
		const xml = `<project><dc:title>Título DC</dc:title></project>`;
		const { metadata } = parseContentXmlForExport(xml);
		expect(metadata.title).toBe("Título DC");
	});
});

describe("createDocumentAdapter", () => {
	test("crea adaptador con getMetadata, getNavigation y projectId", () => {
		const data = {
			metadata: { title: "Test" },
			navigation: { pages: [], pageCount: 0 },
			projectId: "resource-123",
		};
		const adapter = createDocumentAdapter(data) as {
			getMetadata: () => unknown;
			getNavigation: () => unknown;
			projectId: string;
		};

		expect(adapter.getMetadata()).toEqual({ title: "Test" });
		expect(adapter.getNavigation()).toEqual({ pages: [], pageCount: 0 });
		expect(adapter.projectId).toBe("resource-123");
	});
});

describe("createResourceFetcher", () => {
	test("devuelve theme files del .elpx", async () => {
		const files = new Map<string, Uint8Array>();
		files.set("css/style.css", new Uint8Array([1, 2, 3]));
		files.set("theme/base.css", new Uint8Array([4, 5, 6]));
		files.set("index.html", new Uint8Array([7, 8, 9]));

		const fetcher = createResourceFetcher(files) as {
			fetchTheme: (name: string) => Promise<Map<string, Blob>>;
			fetchBaseLibraries: () => Promise<Map<string, Blob>>;
			fetchScormFiles: () => Promise<Map<string, Blob>>;
		};

		const theme = await fetcher.fetchTheme("base");
		expect(theme.size).toBe(2); // css/ and theme/
		expect(theme.has("css/style.css")).toBe(true);
		expect(theme.has("theme/base.css")).toBe(true);
	});

	test("devuelve libraries del .elpx", async () => {
		const files = new Map<string, Uint8Array>();
		files.set("libs/jquery.js", new Uint8Array([1]));
		files.set("js/common.js", new Uint8Array([2]));
		files.set("content.xml", new Uint8Array([3]));

		const fetcher = createResourceFetcher(files) as {
			fetchBaseLibraries: () => Promise<Map<string, Blob>>;
		};

		const libs = await fetcher.fetchBaseLibraries();
		expect(libs.size).toBe(2);
		expect(libs.has("libs/jquery.js")).toBe(true);
		expect(libs.has("js/common.js")).toBe(true);
	});

	test("devuelve mapas vacíos para recursos no disponibles", async () => {
		const fetcher = createResourceFetcher(new Map()) as {
			fetchScormFiles: () => Promise<Map<string, Blob>>;
			fetchIdevice: (t: string) => Promise<Map<string, Blob>>;
			fetchSchemas: (f: string) => Promise<Map<string, Blob>>;
		};

		expect((await fetcher.fetchScormFiles()).size).toBe(0);
		expect((await fetcher.fetchIdevice("text")).size).toBe(0);
		expect((await fetcher.fetchSchemas("scorm12")).size).toBe(0);
	});
});

describe("createAssetManager", () => {
	test("devuelve assets de content/ y resources/", async () => {
		const files = new Map<string, Uint8Array>();
		files.set("content/img/foto.png", new Uint8Array([1, 2, 3]));
		files.set("resources/video.mp4", new Uint8Array([4, 5, 6]));
		files.set("libs/jquery.js", new Uint8Array([7, 8, 9])); // not an asset

		const manager = createAssetManager(files) as {
			getProjectAssets: () => Promise<
				Array<{ id: string; path: string; size: number }>
			>;
			getAsset: (id: string) => Promise<{ id: string } | null>;
		};

		const assets = await manager.getProjectAssets();
		expect(assets).toHaveLength(2);
		expect(assets[0].path).toBe("content/img/foto.png");
		expect(assets[0].size).toBe(3);
		expect(assets[1].path).toBe("resources/video.mp4");
	});

	test("getAsset devuelve null para asset inexistente", async () => {
		const manager = createAssetManager(new Map()) as {
			getAsset: (id: string) => Promise<unknown>;
		};
		expect(await manager.getAsset("nonexistent")).toBeNull();
	});
});

describe("resetBundleLoader", () => {
	test("no lanza error", () => {
		expect(() => resetBundleLoader()).not.toThrow();
	});
});
