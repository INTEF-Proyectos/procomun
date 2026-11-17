import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	resolveRestrictedReportPath,
	writeRestrictedReport,
} from "./restricted-report.ts";

// #543: el correo de los autores sin cuenta solo sale en un informe aparte,
// que se pide de forma explícita, fuera del directorio de los informes
// generales y legible solo por quien lo genera.
describe("informe restringido (#543)", () => {
	let base: string;
	let reportDir: string;
	let restrictedDir: string;

	beforeEach(async () => {
		base = await mkdtemp(path.join(tmpdir(), "restricted-report-"));
		reportDir = path.join(base, "informes");
		restrictedDir = path.join(base, "restringido");
	});

	afterEach(async () => {
		await rm(base, { recursive: true, force: true });
	});

	test("rechaza una ruta dentro del directorio de los informes generales", () => {
		expect(() =>
			resolveRestrictedReportPath(path.join(reportDir, "r.json"), reportDir),
		).toThrow("fuera del directorio de los informes");
		expect(() =>
			resolveRestrictedReportPath(
				path.join(reportDir, "sub", "r.json"),
				reportDir,
			),
		).toThrow("fuera del directorio de los informes");
		expect(() => resolveRestrictedReportPath(reportDir, reportDir)).toThrow(
			"fuera del directorio de los informes",
		);
	});

	test("acepta una ruta fuera y la devuelve absoluta", () => {
		const target = path.join(restrictedDir, "r.json");
		expect(resolveRestrictedReportPath(target, reportDir)).toBe(target);
		// Un directorio hermano con el mismo prefijo no está dentro.
		const sibling = `${reportDir}-restringido/r.json`;
		expect(resolveRestrictedReportPath(sibling, reportDir)).toBe(sibling);
	});

	test("escribe el contenido con permisos 0600 y el aviso de datos personales", async () => {
		const target = path.join(restrictedDir, "autores.json");
		await writeRestrictedReport(target, {
			runId: "run-1",
			kind: "ingesta",
			entries: [
				{
					list: "authorsWithoutAccount",
					externalId: "es_1",
					email: "autora@ejemplo.test",
					reason: "no_account",
				},
			],
		});

		expect((await stat(target)).mode & 0o777).toBe(0o600);
		const written = JSON.parse(await readFile(target, "utf8"));
		expect(written).toMatchObject({
			runId: "run-1",
			kind: "ingesta",
			entries: [
				{
					list: "authorsWithoutAccount",
					externalId: "es_1",
					email: "autora@ejemplo.test",
					reason: "no_account",
				},
			],
		});
		expect(written.aviso).toContain("datos personales");
		expect(written.aviso).toContain("Bórralo");
	});

	test("no pisa un fichero que ya existe", async () => {
		const target = path.join(base, "existente.json");
		await writeFile(target, "previo", { mode: 0o644 });

		await expect(
			writeRestrictedReport(target, {
				runId: "run-1",
				kind: "ingesta",
				entries: [],
			}),
		).rejects.toThrow("ya existe");
		expect(await readFile(target, "utf8")).toBe("previo");
	});
});
