import { spawn } from "node:child_process";

import { buildBunTestArgs, findStandardTestFiles } from "./run-bun-suite.ts";

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

	proc.on("close", (_code) => {
		const coverage = extractLineCoverage(output);

		if (coverage !== null) {
			console.log(`\nCoverage de líneas: ${coverage}%`);

			if (coverage < THRESHOLD) {
				console.error(
					`❌ El coverage (${coverage}%) está por debajo del límite mínimo (${THRESHOLD}%)`,
				);
				process.exit(1);
			} else {
				console.log(`✅ Coverage suficiente (>= ${THRESHOLD}%)`);
				process.exit(0);
			}
		} else {
			console.error(
				"❌ No se pudo determinar el coverage de la salida de bun test --coverage",
			);
			process.exit(1);
		}
	});
}

if (import.meta.main) {
	await runCoverage();
}
