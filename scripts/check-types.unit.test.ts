import { describe, expect, test } from "bun:test";
import {
	compareWithBaseline,
	countTypeErrors,
	formatVerdict,
	summarizeByFile,
	TYPE_ERROR_BASELINE,
} from "./check-types.ts";

const SAMPLE = [
	"apps/api/src/db.ts(12,5): error TS2571: Object is of type 'unknown'.",
	"apps/api/src/db.ts(20,7): error TS2345: Argument of type 'x'.",
	"packages/db/src/repository.ts(3,1): error TS7006: Parameter implicitly any.",
	"",
	"Found 3 errors in 2 files.",
].join("\n");

describe("check-types: recuento", () => {
	test("cuenta solo los diagnósticos, no el resumen de tsc", () => {
		// "Found 3 errors in 2 files." no lleva "error TSnnnn:", así que no cuenta.
		expect(countTypeErrors(SAMPLE)).toBe(3);
	});

	test("una salida limpia da cero", () => {
		expect(countTypeErrors("")).toBe(0);
		expect(countTypeErrors("todo bien\n")).toBe(0);
	});

	test("no confunde texto que solo menciona 'error'", () => {
		const noise = [
			"console.error('error TS algo')",
			"// error TS sin numero",
			"src/a.ts(1,1): error TS1005: ';' expected.",
		].join("\n");
		expect(countTypeErrors(noise)).toBe(1);
	});
});

describe("check-types: ratchet", () => {
	test("más errores que la base es regresión, y dice cuántos de más", () => {
		const v = compareWithBaseline(670, 665);
		expect(v.status).toBe("regressed");
		expect(v).toMatchObject({ count: 670, delta: 5 });
	});

	test("igual que la base pasa", () => {
		expect(compareWithBaseline(665, 665).status).toBe("ok");
	});

	test("menos errores que la base pasa y lo reporta como mejora", () => {
		const v = compareWithBaseline(660, 665);
		expect(v.status).toBe("improved");
		expect(v).toMatchObject({ count: 660, delta: 5 });
	});

	test("un solo error de más ya rompe: es lo que impide que la deuda crezca sola", () => {
		expect(compareWithBaseline(666, 665).status).toBe("regressed");
	});

	test("la línea base por defecto es un número, no undefined", () => {
		expect(typeof TYPE_ERROR_BASELINE).toBe("number");
		expect(TYPE_ERROR_BASELINE).toBeGreaterThan(0);
	});
});

describe("check-types: resumen por fichero", () => {
	test("agrupa por fichero y ordena de más a menos", () => {
		expect(summarizeByFile(SAMPLE)).toEqual([
			{ file: "apps/api/src/db.ts", count: 2 },
			{ file: "packages/db/src/repository.ts", count: 1 },
		]);
	});

	test("respeta el límite", () => {
		expect(summarizeByFile(SAMPLE, 1)).toEqual([
			{ file: "apps/api/src/db.ts", count: 2 },
		]);
	});

	test("con salida limpia devuelve lista vacía", () => {
		expect(summarizeByFile("")).toEqual([]);
	});
});

describe("check-types: reporte", () => {
	test("una regresión sale con código 1 y lista los peores ficheros", () => {
		const { message, exitCode } = formatVerdict(
			compareWithBaseline(670, 665),
			SAMPLE,
		);
		expect(exitCode).toBe(1);
		expect(message).toContain("670");
		expect(message).toContain("+5");
		expect(message).toContain("apps/api/src/db.ts");
		// Debe decir qué hacer, no solo que ha fallado.
		expect(message).toContain("TYPE_ERROR_BASELINE");
	});

	test("una regresión sin salida parseable no inventa la lista de ficheros", () => {
		const { message, exitCode } = formatVerdict(
			compareWithBaseline(670, 665),
			"",
		);
		expect(exitCode).toBe(1);
		expect(message).not.toContain("Ficheros con más errores");
	});

	test("una mejora pasa y pide apretar la línea base", () => {
		const { message, exitCode } = formatVerdict(compareWithBaseline(660, 665));
		expect(exitCode).toBe(0);
		expect(message).toContain("660");
		expect(message).toContain("Baja TYPE_ERROR_BASELINE");
	});

	test("sin cambios pasa y no pide nada", () => {
		const { message, exitCode } = formatVerdict(compareWithBaseline(665, 665));
		expect(exitCode).toBe(0);
		expect(message).toContain("igual que la línea base");
	});
});
