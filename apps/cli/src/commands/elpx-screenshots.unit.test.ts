import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type ElpxScreenshotDeps,
	type ExtractionState,
	parseElpxScreenshotArgs,
	resolveExtractionDir,
	runElpxScreenshotBackfill,
} from "./elpx-screenshots.ts";

const PROJECTS = [
	{ id: "p1", hash: "h1", extractPath: "/elpx/h1", hasScreenshot: false },
	{ id: "p2", hash: "h2", extractPath: "/elpx/h2", hasScreenshot: false },
	{ id: "p3", hash: "h3", extractPath: "/elpx/h3", hasScreenshot: true },
];

function buildDeps(onDisk: Set<string>) {
	const updates: Array<[string, boolean]> = [];
	const deps: ElpxScreenshotDeps = {
		listProjects: async () => PROJECTS,
		setHasScreenshot: async (id, value) => {
			updates.push([id, value]);
		},
		// Las extracciones de estos casos se localizan siempre: aqui se prueba
		// el marcado, no la resolucion de rutas (revisión #471).
		inspectExtraction: async ({ extractPath }) =>
			onDisk.has(extractPath) ? "screenshot" : "no-screenshot",
	};
	return { deps, updates };
}

// #409: relleno de has_screenshot para los paquetes subidos antes del cambio.
describe("runElpxScreenshotBackfill", () => {
	test("marca los paquetes con screenshot.png y corrige los que ya no la tienen", async () => {
		const { deps, updates } = buildDeps(new Set(["/elpx/h1"]));

		const report = await runElpxScreenshotBackfill({ dryRun: false }, deps);

		expect(updates).toEqual([
			["p1", true],
			["p3", false],
		]);
		expect(report).toEqual({
			checked: 3,
			withScreenshot: 1,
			changed: 2,
			// Clave nueva de la revisión #471: aqui todas se localizan.
			unreachable: 0,
			dryRun: false,
		});
	});

	test("--dry-run cuenta los cambios sin escribir", async () => {
		const { deps, updates } = buildDeps(new Set(["/elpx/h1", "/elpx/h3"]));

		const report = await runElpxScreenshotBackfill({ dryRun: true }, deps);

		expect(updates).toEqual([]);
		expect(report).toEqual({
			checked: 3,
			withScreenshot: 2,
			changed: 1,
			unreachable: 0,
			dryRun: true,
		});
	});
});

describe("parseElpxScreenshotArgs", () => {
	test("reconoce --dry-run", () => {
		expect(parseElpxScreenshotArgs(["--dry-run"])).toEqual({ dryRun: true });
		expect(parseElpxScreenshotArgs([])).toEqual({ dryRun: false });
	});

	test("rechaza argumentos desconocidos", () => {
		expect(() => parseElpxScreenshotArgs(["--otro"])).toThrow("--otro");
	});
});

// Hallazgo de la revisión de #471: el comando pasaba `extractPath` tal cual.
// Si `UPLOAD_STORAGE_DIR` es relativo —admitido y documentado en ADR-0011—, la
// API pudo guardar esa ruta ejecutándose desde `apps/api` y el comando se lanza
// desde la raíz del repositorio: la misma ruta apunta a otro directorio, el
// escaneo no encuentra nada y el comando persistía `hasScreenshot = false`
// sobre una captura que sigue ahí.
describe("extracción ilocalizable (revisión #471)", () => {
	const PROJECT = {
		id: "p-rel",
		hash: "hash-rel",
		extractPath: "local-data/uploads/elpx/hash-rel",
		hasScreenshot: true,
	};

	function depsWith(state: ExtractionState) {
		const updates: Array<[string, boolean]> = [];
		const deps: ElpxScreenshotDeps = {
			listProjects: async () => [PROJECT],
			setHasScreenshot: async (id, value) => {
				updates.push([id, value]);
			},
			inspectExtraction: async () => state,
		};
		return { deps, updates };
	}

	test("no persiste false cuando no puede localizar la extracción", async () => {
		const { deps, updates } = depsWith("unreachable");
		const report = await runElpxScreenshotBackfill({ dryRun: false }, deps);

		// Lo que fallaba: escribía [["p-rel", false]] y la tarjeta dejaba de
		// usar una captura que existe.
		expect(updates).toEqual([]);
		expect(report.unreachable).toBe(1);
		expect(report.changed).toBe(0);
		expect(report.checked).toBe(1);
	});

	test("una extracción localizada sin screenshot.png sí persiste false", async () => {
		// Hay que distinguir «no la encuentro» de «no la tiene».
		const { deps, updates } = depsWith("no-screenshot");
		const report = await runElpxScreenshotBackfill({ dryRun: false }, deps);

		expect(updates).toEqual([["p-rel", false]]);
		expect(report.unreachable).toBe(0);
		expect(report.changed).toBe(1);
	});

	test("una extracción con screenshot.png no cambia nada si ya estaba marcada", async () => {
		const { deps, updates } = depsWith("screenshot");
		const report = await runElpxScreenshotBackfill({ dryRun: false }, deps);

		expect(updates).toEqual([]);
		expect(report.withScreenshot).toBe(1);
		expect(report.changed).toBe(0);
	});
});

// La resolución en sí: una ruta relativa guardada por la API tiene que
// encontrarse aunque el CLI se ejecute desde otro directorio.
describe("resolveExtractionDir (revisión #471)", () => {
	test("una ruta absoluta que existe se usa tal cual", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "elpx-abs-"));
		const dir = path.join(root, "elpx", "h-abs");
		await mkdir(dir, { recursive: true });

		expect(await resolveExtractionDir(dir, "h-abs", root)).toBe(dir);
	});

	test("una ruta relativa se resuelve contra el almacén por su hash", async () => {
		// Es lo que pasa con UPLOAD_STORAGE_DIR relativo: la ruta guardada no
		// existe desde el directorio del CLI, pero el paquete sí está.
		const root = await mkdtemp(path.join(tmpdir(), "elpx-rel-"));
		const dir = path.join(root, "elpx", "h-rel");
		await mkdir(dir, { recursive: true });

		expect(
			await resolveExtractionDir(
				"local-data/uploads/elpx/h-rel",
				"h-rel",
				root,
			),
		).toBe(dir);
	});

	test("si no está en ningún sitio devuelve null, para no persistir false", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "elpx-none-"));
		expect(
			await resolveExtractionDir("local-data/uploads/elpx/h-no", "h-no", root),
		).toBeNull();
	});
});
