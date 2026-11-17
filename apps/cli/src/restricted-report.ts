/**
 * Informe restringido de los importadores legacy (#543).
 *
 * El informe general de un importador no lleva datos personales: de un
 * recurso sin cuenta de autor solo da el identificador, el resultado y el
 * motivo. Para resolver esas incidencias de la migración, el operador puede
 * pedir de forma explícita (`--restricted-report <ruta>`) un informe aparte
 * con el correo de origen. Sin esa opción el correo no se guarda en ningún
 * sitio.
 *
 * La separación tiene que ser efectiva, no otro fichero junto al general:
 * - la ruta la elige el operador y no puede estar dentro del directorio de
 *   los informes generales;
 * - el fichero se crea nuevo (nunca se pisa otro) con permisos 0600, solo
 *   legible por quien ejecuta el importador;
 * - lleva un aviso para borrarlo cuando se resuelvan las incidencias.
 */
import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";

export interface RestrictedReportEntry {
	/** Lista del informe general en la que está el registro. */
	list: string;
	externalId: string;
	/** Correo de origen normalizado; null si el registro no lo trae. */
	email: string | null;
	reason: string;
	/** Creador real que se conserva, si lo hay. */
	createdBy?: string;
}

export interface RestrictedReport {
	runId: string;
	/** Tipo de ejecución, el mismo que da nombre al informe general. */
	kind: string;
	entries: RestrictedReportEntry[];
}

export const RESTRICTED_REPORT_NOTICE =
	"Informe restringido: contiene datos personales (correos de origen) para resolver las incidencias de la migración. Solo para el personal que las resuelve. Bórralo al terminar.";

/**
 * Ruta absoluta del informe restringido. Falla si cae dentro del directorio
 * de los informes generales: ahí acabaría con ellos (copias, adjuntos).
 */
export function resolveRestrictedReportPath(
	rawPath: string,
	reportDir: string,
): string {
	const target = path.resolve(rawPath);
	const relative = path.relative(path.resolve(reportDir), target);
	const inside =
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative));
	if (inside) {
		throw new Error(
			"--restricted-report debe estar fuera del directorio de los informes generales (--report-dir)",
		);
	}
	return target;
}

/**
 * Crea el informe restringido con permisos 0600. Nunca pisa un fichero que
 * ya existe (podría tener otros permisos o ser un enlace).
 */
export async function writeRestrictedReport(
	filePath: string,
	report: RestrictedReport,
): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(filePath, "wx", 0o600);
	} catch (error) {
		if ((error as { code?: string }).code === "EEXIST") {
			throw new Error(
				`El informe restringido ya existe en ${filePath}: bórralo o elige otra ruta`,
			);
		}
		throw error;
	}
	try {
		// La umask solo quita permisos; se fija igualmente por si acaso.
		await chmod(filePath, 0o600);
		await handle.writeFile(
			JSON.stringify(
				{
					aviso: RESTRICTED_REPORT_NOTICE,
					runId: report.runId,
					kind: report.kind,
					generatedAt: new Date().toISOString(),
					entries: report.entries,
				},
				null,
				2,
			),
		);
	} finally {
		await handle.close();
	}
}
