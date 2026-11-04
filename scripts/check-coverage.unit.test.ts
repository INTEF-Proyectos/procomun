import { describe, expect, test } from "bun:test";
import {
	evaluateCoverageRun,
	extractFailedTestCount,
	extractLineCoverage,
	stripAnsiCodes,
} from "./check-coverage.ts";

describe("check-coverage helpers", () => {
	test("stripAnsiCodes removes terminal escape sequences", () => {
		expect(stripAnsiCodes("\u001b[31merror\u001b[0m")).toBe("error");
	});

	test("extractLineCoverage parses bun coverage output", () => {
		const output = [
			"File | % Funcs | % Lines",
			"All files | 91.20 | 93.40",
		].join("\n");

		expect(extractLineCoverage(output)).toBe(93.4);
	});

	test("extractLineCoverage returns null when coverage summary is missing", () => {
		expect(extractLineCoverage("sin resumen")).toBeNull();
	});
});

// Resumen tal y como lo imprime bun test --coverage al final de la ejecución.
function bunOutput({ fail, lines }: { fail: number; lines: string }) {
	return [
		"(pass) suite > un test [1.00ms]",
		...(fail > 0 ? ["(fail) suite > otro test [2.00ms]"] : []),
		"File | % Funcs | % Lines | Uncovered Line #s",
		`All files | 95.00 | ${lines} |`,
		"",
		" 1308 pass",
		` ${fail} fail`,
		" 4210 expect() calls",
		`Ran ${1308 + fail} tests across 148 files. [236.92s]`,
	].join("\n");
}

describe("extractFailedTestCount", () => {
	test("lee el número de fallos del resumen final", () => {
		expect(extractFailedTestCount(bunOutput({ fail: 4, lines: "96.00" }))).toBe(
			4,
		);
		expect(extractFailedTestCount(bunOutput({ fail: 0, lines: "96.00" }))).toBe(
			0,
		);
	});

	test("ignora los códigos ANSI de color", () => {
		expect(extractFailedTestCount("\u001b[31m 2 fail\u001b[0m\n")).toBe(2);
	});

	test("devuelve null si no hay resumen", () => {
		expect(extractFailedTestCount("sin resumen")).toBeNull();
	});
});

describe("evaluateCoverageRun", () => {
	test("pasa con tests en verde y coverage por encima del umbral", () => {
		const verdict = evaluateCoverageRun(
			0,
			bunOutput({ fail: 0, lines: "93.40" }),
		);

		expect(verdict).toEqual({ ok: true, coverage: 93.4, errors: [] });
	});

	test("falla si bun test sale con código distinto de 0 aunque el coverage llegue", () => {
		// Lo que pasaba en main: «1308 pass / 4 fail», coverage suficiente y CI en verde.
		const verdict = evaluateCoverageRun(
			1,
			bunOutput({ fail: 4, lines: "96.00" }),
		);

		expect(verdict.ok).toBe(false);
		expect(verdict.coverage).toBe(96);
		expect(verdict.errors).toEqual([
			"❌ bun test informa de 4 test(s) fallido(s)",
		]);
	});

	test("falla si el resumen tiene fallos aunque el código de salida sea 0", () => {
		const verdict = evaluateCoverageRun(
			0,
			bunOutput({ fail: 1, lines: "96.00" }),
		);

		expect(verdict.ok).toBe(false);
		expect(verdict.errors).toEqual([
			"❌ bun test informa de 1 test(s) fallido(s)",
		]);
	});

	test("falla con código distinto de 0 aunque el resumen diga 0 fallos", () => {
		// Un error no capturado fuera de un test: bun imprime «0 fail» y sale con 1.
		const verdict = evaluateCoverageRun(
			1,
			bunOutput({ fail: 0, lines: "96.00" }),
		);

		expect(verdict.ok).toBe(false);
		expect(verdict.errors).toEqual(["❌ bun test terminó con código 1"]);
	});

	test("falla si bun test no llega a terminar", () => {
		const verdict = evaluateCoverageRun(null, "");

		expect(verdict.ok).toBe(false);
		expect(verdict.errors).toContain(
			"❌ bun test no terminó (proceso interrumpido por una señal)",
		);
	});

	test("tolera el código 99/100 de bun si el resumen dice 0 fallos, igual que run-bun-suite", () => {
		const verdict = evaluateCoverageRun(
			99,
			bunOutput({ fail: 0, lines: "93.40" }),
		);

		expect(verdict.ok).toBe(true);
	});

	test("mantiene el umbral de coverage con los tests en verde", () => {
		const verdict = evaluateCoverageRun(
			0,
			bunOutput({ fail: 0, lines: "89.99" }),
		);

		expect(verdict.ok).toBe(false);
		expect(verdict.errors).toEqual([
			"❌ El coverage (89.99%) está por debajo del límite mínimo (90%)",
		]);
	});

	test("informa a la vez de tests fallidos y coverage insuficiente", () => {
		const verdict = evaluateCoverageRun(
			1,
			bunOutput({ fail: 2, lines: "80.00" }),
		);

		expect(verdict.errors).toEqual([
			"❌ bun test informa de 2 test(s) fallido(s)",
			"❌ El coverage (80%) está por debajo del límite mínimo (90%)",
		]);
	});

	test("falla si no encuentra el resumen de coverage", () => {
		const verdict = evaluateCoverageRun(0, " 10 pass\n 0 fail\n");

		expect(verdict.ok).toBe(false);
		expect(verdict.errors).toEqual([
			"❌ No se pudo determinar el coverage de la salida de bun test --coverage",
		]);
	});

	test("acepta un umbral explícito", () => {
		expect(
			evaluateCoverageRun(0, bunOutput({ fail: 0, lines: "80.00" }), 75).ok,
		).toBe(true);
	});
});
