import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { classifyEmbed, canonicalizeProvider } from "./elpx-embed-policy.ts";

const PAGE_ORIGIN = "https://procomun.example";
const CONTENT_BASE = "https://api.procomun.example/api/v1/elpx/abc123/index.html";

// ---------------------------------------------------------------------------
// classifyEmbed — casos unitarios (incluye invariantes de seguridad)
// ---------------------------------------------------------------------------
describe("classifyEmbed", () => {
	test("promociona YouTube como vídeo y lo canonicaliza a youtube-nocookie", () => {
		const r = classifyEmbed("https://www.youtube.com/embed/aqz-KE-bpKQ", {
			pageOrigin: PAGE_ORIGIN,
			contentBaseUrl: CONTENT_BASE,
		});
		expect(r).toEqual({
			kind: "video",
			url: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
		});
	});

	test("promociona Vimeo como vídeo (passthrough)", () => {
		const src = "https://player.vimeo.com/video/76979871?title=0&byline=0";
		const r = classifyEmbed(src, { pageOrigin: PAGE_ORIGIN });
		expect(r?.kind).toBe("video");
		expect(r?.url).toContain("player.vimeo.com/video/76979871");
	});

	test("promociona Mediateca Madrid como vídeo", () => {
		const r = classifyEmbed(
			"https://mediateca.educa.madrid.org/video/u555bvi3bk5wsabh/fs",
			{ pageOrigin: PAGE_ORIGIN },
		);
		expect(r?.kind).toBe("video");
	});

	test("clasifica un .pdf remoto https como pdf", () => {
		const r = classifyEmbed(
			"https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf",
			{ pageOrigin: PAGE_ORIGIN },
		);
		expect(r).toEqual({
			kind: "pdf",
			url: "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf",
		});
	});

	test("permite un .pdf del propio paquete (same-origin al contenido)", () => {
		const r = classifyEmbed(
			"https://api.procomun.example/api/v1/elpx/abc123/docs/guia.pdf",
			{ pageOrigin: PAGE_ORIGIN, contentBaseUrl: CONTENT_BASE },
		);
		expect(r?.kind).toBe("pdf");
	});

	// --- Invariantes de seguridad ---
	test("NO promociona vídeo same-origin a la app (evita escape del aislamiento)", () => {
		expect(
			classifyEmbed("https://procomun.example/algo/embed/x", {
				pageOrigin: PAGE_ORIGIN,
			}),
		).toBeNull();
	});

	test("NO promociona vídeo same-origin al contenido", () => {
		expect(
			classifyEmbed("https://api.procomun.example/api/v1/elpx/abc123/inner.html", {
				pageOrigin: PAGE_ORIGIN,
				contentBaseUrl: CONTENT_BASE,
			}),
		).toBeNull();
	});

	test("rechaza http (no https)", () => {
		expect(
			classifyEmbed("http://www.youtube.com/embed/x", { pageOrigin: PAGE_ORIGIN }),
		).toBeNull();
	});

	test("rechaza URLs con credenciales (userinfo)", () => {
		expect(
			classifyEmbed("https://evil@www.youtube.com/embed/x", {
				pageOrigin: PAGE_ORIGIN,
			}),
		).toBeNull();
	});

	test("rechaza URL no parseable / relativa", () => {
		expect(classifyEmbed("/local/video", { pageOrigin: PAGE_ORIGIN })).toBeNull();
		expect(classifyEmbed("not a url", { pageOrigin: PAGE_ORIGIN })).toBeNull();
	});
});

describe("canonicalizeProvider", () => {
	test("youtu.be → youtube-nocookie/embed", () => {
		expect(canonicalizeProvider(new URL("https://youtu.be/aqz-KE-bpKQ"))).toBe(
			"https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
		);
	});
	test("host desconocido pasa tal cual", () => {
		const href = "https://example.com/embed/123";
		expect(canonicalizeProvider(new URL(href))).toBe(href);
	});
});

// ---------------------------------------------------------------------------
// Driven sobre los embeds reales de remote-embeds.elpx
// ---------------------------------------------------------------------------
describe("classifyEmbed sobre remote-embeds.elpx (fixture real)", () => {
	const FIXTURE = path.resolve(
		import.meta.dir,
		"../../../api/src/test-fixtures/elpx/remote-embeds.elpx",
	);
	let srcs: string[] = [];
	let tempDir: string;

	beforeAll(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "embed-fixture-"));
		const proc = Bun.spawn(["unzip", "-o", "-q", FIXTURE, "-d", tempDir], {
			stdout: "ignore",
			stderr: "ignore",
		});
		await proc.exited;

		const found = new Set<string>();
		async function walk(dir: string): Promise<void> {
			for (const e of await readdir(dir, { withFileTypes: true })) {
				const full = path.join(dir, e.name);
				if (e.isDirectory()) await walk(full);
				else if (e.name.endsWith(".html")) {
					const html = await readFile(full, "utf-8");
					const re = /<iframe[^>]*\ssrc="([^"]+)"/gi;
					let m: RegExpExecArray | null;
					while ((m = re.exec(html)) !== null) {
						if (m[1]) found.add(m[1].replace(/&amp;/g, "&"));
					}
				}
			}
		}
		await walk(tempDir);
		srcs = [...found];
	});

	afterAll(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("el fixture contiene los 4 embeds esperados", () => {
		expect(srcs.some((s) => s.includes("youtube.com/embed/"))).toBe(true);
		expect(srcs.some((s) => s.includes("player.vimeo.com/video/"))).toBe(true);
		expect(srcs.some((s) => s.includes("mediateca.educa.madrid.org/video/"))).toBe(true);
		expect(srcs.some((s) => /\.pdf(\?|$)/i.test(s))).toBe(true);
	});

	test("todos los embeds del fixture se clasifican (vídeo o pdf), ninguno se descarta", () => {
		for (const src of srcs) {
			const r = classifyEmbed(src, {
				pageOrigin: PAGE_ORIGIN,
				contentBaseUrl: CONTENT_BASE,
			});
			expect(r).not.toBeNull();
			const isPdf = /\.pdf(\?|$)/i.test(src);
			expect(r?.kind).toBe(isPdf ? "pdf" : "video");
		}
	});
});
