import { spawn } from "node:child_process";

import {
	buildBunTestArgs,
	findStandardTestFiles,
	isPassingBunExit,
} from "./run-bun-suite.ts";

const THRESHOLD = 90;
const ALL_FILES_REGEX = /All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/;

// Elimina secuencias de escape ANSI (ESC `[` dígitos/`;` letra final) de los
// logs de bun, escaneando por code point para no usar caracteres de control
// en una regex. Semántica idéntica a la antigua regex /\x1B\[[0-9;]*[a-zA-Z]/g.
export function stripAnsiCodes(output: string) {
	let result = "";
	let i = 0;
	while (i < output.length) {
		if (output.charCodeAt(i) === 0x1b && output.charAt(i + 1) === "[") {
			let j = i + 2;
			while (j < output.length && "0123456789;".includes(output.charAt(j))) {
				j++;
			}
			const final = output.charAt(j);
			if (/[a-zA-Z]/.test(final)) {
				i = j + 1;
				continue;
			}
		}
		result += output.charAt(i);
		i++;
	}
	return result;
}

export function extractLineCoverage(output: string) {
	const cleanOutput = stripAnsiCodes(output);
	const match = cleanOutput.match(ALL_FILES_REGEX);
	return match?.[2] ? Number.parseFloat(match[2]) : null;
}

// Fallos del resumen final de bun test (« 4 fail»). Se toma la última línea
// por si algún test imprime algo parecido antes del resumen.
export function extractFailedTestCount(output: string) {
	const matches = [...stripAnsiCodes(output).matchAll(/^\s*(\d+) fail\s*$/gm)];
	const last = matches.at(-1);
	return last?.[1] ? Number.parseInt(last[1], 10) : null;
}

export type CoverageVerdict = {
	ok: boolean;
	coverage: number | null;
	errors: string[];
};

// Decide si el paso «Run Tests & Coverage» pasa. Antes solo miraba el
// coverage e ignoraba el código de salida: con «1308 pass / 4 fail» el CI
// salía en verde. Ahora exige las dos cosas: tests en verde y umbral.
export function evaluateCoverageRun(
	exitCode: number | null,
	output: string,
	threshold = THRESHOLD,
): CoverageVerdict {
	const errors: string[] = [];
	const failed = extractFailedTestCount(output);

	if (failed !== null && failed > 0) {
		errors.push(`❌ bun test informa de ${failed} test(s) fallido(s)`);
	} else if (exitCode === null) {
		errors.push("❌ bun test no terminó (proceso interrumpido por una señal)");
	} else if (!isPassingBunExit(exitCode, stripAnsiCodes(output))) {
		errors.push(`❌ bun test terminó con código ${exitCode}`);
	}

	const coverage = extractLineCoverage(output);

	if (coverage === null) {
		errors.push(
			"❌ No se pudo determinar el coverage de la salida de bun test --coverage",
		);
	} else if (coverage < threshold) {
		errors.push(
			`❌ El coverage (${coverage}%) está por debajo del límite mínimo (${threshold}%)`,
		);
	}

	return { ok: errors.length === 0, coverage, errors };
}

async function runCoverage() {
	const files = await findStandardTestFiles();

	if (files.length === 0) {
		console.error("❌ No se encontraron tests estándar para calcular coverage");
		process.exit(1);
	}

	const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" };
	const proc = spawn("bun", buildBunTestArgs(files, { coverage: true }), {
		env,
	});

	let output = "";

	proc.stdout.on("data", (data) => {
		output += data.toString();
		process.stdout.write(data);
	});

	proc.stderr.on("data", (data) => {
		output += data.toString();
		process.stderr.write(data);
	});

	proc.on("error", (error) => {
		console.error(`❌ No se pudo lanzar bun test: ${error.message}`);
		process.exit(1);
	});

	proc.on("close", (code) => {
		const verdict = evaluateCoverageRun(code, output);

		if (verdict.coverage !== null) {
			console.log(`\nCoverage de líneas: ${verdict.coverage}%`);
		}

		if (!verdict.ok) {
			for (const error of verdict.errors) {
				console.error(error);
			}
			process.exit(1);
		}

		console.log(`✅ Tests en verde y coverage suficiente (>= ${THRESHOLD}%)`);
		process.exit(0);
	});
}

if (import.meta.main) {
	await runCoverage();
}
