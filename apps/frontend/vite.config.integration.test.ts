import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import config from "./vite.config.ts";

/**
 * #492. Arranca el watcher real de Vite con las opciones `server.watch` del
 * frontend y comprueba qué llega al hook `watchChange`, que es el que usa el
 * plugin de Paraglide para recompilar. Las escrituras del SDK de inlang en
 * project.inlang/ no deben llegar; los cambios en messages/ sí.
 */

const EVENT_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
const GRACE_MS = 500;

// Los ficheros que el SDK escribe al abrir por primera vez un proyecto limpio.
const INLANG_SDK_WRITES = [
	"project.inlang/settings.json",
	"project.inlang/.lix/README.md",
	"project.inlang/.meta.json",
	"project.inlang/README.md",
	"project.inlang/.gitignore",
	"project.inlang/cache/plugins/3fhvg7lmyjji3",
	"project.inlang/cache/paraglide-js/588dbae5c71e427f.json",
];

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("watcher de Vite con la config del frontend (#492)", () => {
	let root = "";
	let server: ViteDevServer | undefined;
	const changes: string[] = [];

	function write(relativePath: string, content: string) {
		const absolutePath = join(root, relativePath);
		mkdirSync(join(absolutePath, ".."), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	function seen(relativePath: string) {
		const absolutePath = join(root, relativePath);
		return changes.some((file) => file === absolutePath);
	}

	// Reescribe el fichero hasta que el watcher lo notifica. Sirve también
	// para saber que el watcher ya está activo, sin depender de su evento
	// `ready`, que puede llegar antes de que el test se suscriba.
	async function writeUntilSeen(relativePath: string) {
		const absolutePath = join(root, relativePath);
		const before = changes.filter((file) => file === absolutePath).length;
		const deadline = Date.now() + EVENT_TIMEOUT_MS;
		let attempt = 0;
		while (Date.now() < deadline) {
			write(relativePath, `{"intento": ${attempt++}}`);
			await sleep(POLL_MS * 3);
			const now = changes.filter((file) => file === absolutePath).length;
			if (now > before) return;
		}
		throw new Error(`El watcher no notificó ${relativePath}`);
	}

	beforeAll(async () => {
		if (typeof config === "function") {
			throw new Error("Expected static Vite config object.");
		}
		root = realpathSync(mkdtempSync(join(tmpdir(), "procomun-vite-watch-")));
		write("index.html", "<!doctype html>");
		write("messages/es.json", "{}");
		write("project.inlang/settings.json", "{}");

		const probe: Plugin = {
			name: "watch-change-probe",
			watchChange(id) {
				changes.push(id);
			},
		};
		server = await createServer({
			configFile: false,
			root,
			logLevel: "silent",
			plugins: [probe],
			optimizeDeps: { noDiscovery: true, include: [] },
			server: {
				middlewareMode: true,
				ws: false,
				watch: config.server?.watch,
			},
		});
	}, 20_000);

	afterAll(async () => {
		await server?.close();
		if (root) rmSync(root, { recursive: true, force: true });
	});

	test("no avisa al plugin de lo que el SDK escribe en project.inlang/ y sí de messages/", async () => {
		// Watcher activo: un cambio en messages/ llega a watchChange.
		await writeUntilSeen("messages/es.json");

		for (const file of INLANG_SDK_WRITES) {
			write(file, "{}");
		}
		// Un cambio posterior en messages/ marca el final: si las escrituras de
		// project.inlang/ fueran a notificarse, ya habrían llegado.
		await writeUntilSeen("messages/es.json");
		await sleep(GRACE_MS);

		const notified = INLANG_SDK_WRITES.filter(seen);
		expect(notified).toEqual([]);
		expect(changes.some((file) => file.includes("/project.inlang/"))).toBe(
			false,
		);
	}, 30_000);
});
