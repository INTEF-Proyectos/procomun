/**
 * PGlite (Postgres en WASM) fija `process.exitCode = 99` al arrancar: es la
 * red de seguridad de `quit_()` en Emscripten. Hasta 0.5.4, `close()` llamaba
 * a `_emscripten_force_exit(0)` y dejaba el proceso en 0 por accidente. Desde
 * 0.5.5, `close()` preserva el exit code del host, así que un seed que terminó
 * bien sale con 99 y GitHub Actions marca el job en rojo.
 *
 * El CLI no debe filtrar ese 99 residual. Un fallo real sigue siendo 1.
 */
export const PGLITE_RESIDUAL_EXIT_CODE = 99;

export function clearPgliteResidualExitCode(
	exitCode: number | undefined,
): number | undefined {
	if (exitCode === PGLITE_RESIDUAL_EXIT_CODE) {
		return 0;
	}
	return exitCode;
}

export function applySuccessfulCliExit(): 0 {
	process.exitCode = 0;
	return 0;
}
