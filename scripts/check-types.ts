/**
 * Puerta de tipos con línea base (ratchet).
 *
 * Por qué existe: el paso "Type Check" de CI corría `bunx tsc --noEmit` con
 * `continue-on-error: true`. Eso hace que GitHub reescriba la conclusión del
 * paso a **success** aunque tsc emita cientos de errores y salga con código 1.
 * Resultado: una marca verde para una puerta que no comprobaba nada — la misma
 * clase de mentira que el paquete `biome` equivocado que arregló la PR #272, y
 * la última que quedaba.
 *
 * Historia (issue #282): la línea base partió de ~612 y se quemó a 0 con
 * arreglos reales (tipado de DrizzleDB, css.d.ts, paraglide en CI, narrowing).
 * Con baseline 0 el ratchet es un typecheck estricto: cualquier error nuevo
 * rompe CI.
 *
 * Paraglide se genera en el script npm `check-types` (package.json) ANTES de
 * invocar este fichero: `apps/frontend/src/paraglide` es generado y no
 * versionado; sin él CI inventaba ~16 errores de "Cannot find module".
 */

// 0 = typecheck limpio (issue #282). Si alguna PR reintroduce errores, o los
// arregla o sube esta constante documentando por qué (no debería hacer falta).
export const TYPE_ERROR_BASELINE = 0;

/** Cuenta los diagnósticos de tsc en su salida. */
export function countTypeErrors(output: string): number {
	return output.split("\n").filter((line) => /error TS\d+:/.test(line)).length;
}

export type BaselineVerdict =
	| { status: "ok"; count: number }
	| { status: "improved"; count: number; delta: number }
	| { status: "regressed"; count: number; delta: number };

/** Compara el recuento con la línea base. Solo "regressed" debe romper CI. */
export function compareWithBaseline(
	count: number,
	baseline = TYPE_ERROR_BASELINE,
): BaselineVerdict {
	if (count > baseline) {
		return { status: "regressed", count, delta: count - baseline };
	}
	if (count < baseline) {
		return { status: "improved", count, delta: baseline - count };
	}
	return { status: "ok", count };
}

/** Ficheros con más errores, para orientar a quien tenga que arreglarlos. */
export function summarizeByFile(
	output: string,
	limit = 5,
): { file: string; count: number }[] {
	const perFile = new Map<string, number>();
	for (const line of output.split("\n")) {
		const match = line.match(/^(\S+?)\(\d+,\d+\): error TS\d+:/);
		const file = match?.[1];
		if (!file) continue;
		perFile.set(file, (perFile.get(file) ?? 0) + 1);
	}
	return [...perFile.entries()]
		.map(([file, count]) => ({ file, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit);
}

/** Mensaje y código de salida para un veredicto. Separado de main() para poder
 *  probar el reporte sin lanzar tsc: es donde está la lógica que importa. */
export function formatVerdict(
	verdict: BaselineVerdict,
	output = "",
): { message: string; exitCode: number } {
	if (verdict.status === "regressed") {
		const worst = summarizeByFile(output)
			.map(({ file, count }) => `  ${count}\t${file}`)
			.join("\n");
		return {
			exitCode: 1,
			message:
				`\n❌ Errores de tipos: ${verdict.count} (línea base ${TYPE_ERROR_BASELINE}, +${verdict.delta})\n` +
				(worst ? `\nFicheros con más errores:\n${worst}\n` : "") +
				"\nEsta PR añade errores de tipos nuevos. Arréglalos, o si es " +
				"deliberado, sube TYPE_ERROR_BASELINE en scripts/check-types.ts " +
				"explicando por qué en la descripción de la PR.\n",
		};
	}

	if (verdict.status === "improved") {
		return {
			exitCode: 0,
			message:
				`✅ Errores de tipos: ${verdict.count} — ${verdict.delta} menos que la línea base (${TYPE_ERROR_BASELINE}).\n` +
				`   Baja TYPE_ERROR_BASELINE a ${verdict.count} en scripts/check-types.ts para que no vuelvan a colarse.`,
		};
	}

	return {
		exitCode: 0,
		message:
			TYPE_ERROR_BASELINE === 0
				? "✅ Errores de tipos: 0 (typecheck limpio)."
				: `✅ Errores de tipos: ${verdict.count}, igual que la línea base.`,
	};
}

/** Lanza tsc y devuelve su salida completa. */
async function runTsc(): Promise<string> {
	const proc = Bun.spawn(["bunx", "tsc", "--noEmit"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	// Se leen los streams antes de esperar al proceso: con "pipe" y una salida
	// grande, el buffer se llena y el hijo se bloquea escribiendo (el mismo
	// cuelgue que arregló la #268 en el importador).
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return `${stdout}\n${stderr}`;
}

async function main() {
	const output = await runTsc();
	const verdict = compareWithBaseline(countTypeErrors(output));
	const { message, exitCode } = formatVerdict(verdict, output);

	if (exitCode === 0) {
		console.log(message);
		return;
	}
	console.error(message);
	process.exit(exitCode);
}

if (import.meta.main) {
	await main();
}
