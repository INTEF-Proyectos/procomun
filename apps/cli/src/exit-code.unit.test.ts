import { afterEach, describe, expect, test } from "bun:test";
import {
	applySuccessfulCliExit,
	clearPgliteResidualExitCode,
	PGLITE_RESIDUAL_EXIT_CODE,
} from "./exit-code.ts";

describe("clearPgliteResidualExitCode", () => {
	test("convierte el 99 residual de PGlite en 0", () => {
		expect(clearPgliteResidualExitCode(PGLITE_RESIDUAL_EXIT_CODE)).toBe(0);
	});

	test("no toca un código de error real", () => {
		expect(clearPgliteResidualExitCode(1)).toBe(1);
	});

	test("deja undefined cuando el proceso no tenía código", () => {
		expect(clearPgliteResidualExitCode(undefined)).toBeUndefined();
	});
});

describe("applySuccessfulCliExit", () => {
	afterEach(() => {
		process.exitCode = 0;
	});

	test("fuerza 0 aunque PGlite haya dejado 99", () => {
		process.exitCode = PGLITE_RESIDUAL_EXIT_CODE;
		expect(applySuccessfulCliExit()).toBe(0);
		expect(process.exitCode).toBe(0);
	});
});
