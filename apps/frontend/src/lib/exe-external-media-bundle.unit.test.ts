import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El artefacto external-media vendorizado desde el core de eXeLearning.
 *
 * Estos tests miran los BYTES servidos, no la ruta de importación, porque la ruta es lo
 * que cambia un refactor y los bytes son lo que ejecuta un alumno. El core es canónico
 * (eXe ADR-0021): este repo guarda los bytes y los verifica contra el manifest publicado,
 * en vez de una copia de la lógica que pueda divergir.
 *
 * El test hermano `exe-embed-relay.unit.test.ts` sigue apuntando al fichero clásico, que
 * YA NO se carga. Se conserva a propósito como referencia de equivalencia mientras dure
 * la paridad; desaparece cuando desaparezca el fichero.
 */
const DIST = join(import.meta.dir, "../../public/elpx/exe_external_media");
const read = (name: string) => readFileSync(join(DIST, name), "utf8");
const manifest = JSON.parse(read("exe-external-media.manifest.json")) as {
	buildHash: string;
	files: Record<
		"child" | "host",
		{ path: string; sha256: string; bytes: number }
	>;
};

/** Las dos mitades del artefacto, tipadas para que indexar el manifest no pierda el literal. */
const HALVES: ("child" | "host")[] = ["child", "host"];

describe("artefacto external-media vendorizado", () => {
	test("el manifest cubre las dos mitades", () => {
		expect(Object.keys(manifest.files).sort()).toEqual(["child", "host"]);
	});

	test.each(HALVES)(
		"los bytes de %s coinciden con su digest publicado",
		async (half) => {
			const record = manifest.files[half];
			const bytes = readFileSync(join(DIST, record.path));
			const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

			expect(digest).toBe(record.sha256);
			expect(bytes.length).toBe(record.bytes);
		},
	);

	/**
	 * Editar un fichero y su digest a la vez es la forma obvia de burlar una comprobación
	 * por fichero, así que el buildHash cubre la propia lista de digests.
	 */
	test("el buildHash cubre la lista de ficheros", () => {
		const recomputed = new Bun.CryptoHasher("sha256")
			.update(
				Object.entries(manifest.files)
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([key, record]) => `${key}:${record.sha256}`)
					.join("\n"),
			)
			.digest("hex");

		expect(manifest.buildHash).toBe(recomputed);
	});

	/**
	 * eXe ADR-0018: estos bytes se redistribuyen, así que la concesión de licencia tiene que
	 * viajar CON ellos. Los minificadores borran comentarios normales — por eso se
	 * comprueba sobre la salida y no sobre la fuente.
	 */
	test.each(HALVES)(
		"%s lleva la doble licencia en los bytes servidos",
		(half) => {
			expect(read(manifest.files[half].path)).toContain(
				"SPDX-License-Identifier: AGPL-3.0-or-later OR GPL-3.0-or-later",
			);
		},
	);

	/** El host no debe cargar ningún SDK de proveedor: se controlan por postMessage crudo. */
	test("el host no arrastra los SDK de YouTube ni de Vimeo", () => {
		const host = read(manifest.files.host.path);

		expect(host).not.toContain("YT.Player");
		expect(host).not.toContain("Vimeo.Player");
		expect(host).toContain("enablejsapi");
	});

	/** La mitad de contenido no puede llevar la mitad de confianza, ni al revés. */
	test("las dos mitades respetan la frontera de privilegio", () => {
		expect(read(manifest.files.child.path)).toContain("exeExternalMediaChild");
		expect(read(manifest.files.host.path)).toContain("exeExternalMediaHost");
		expect(read(manifest.files.child.path)).not.toContain(
			"exeExternalMediaHost",
		);
	});
});
