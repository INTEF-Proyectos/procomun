import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserHandle } from "./browser.ts";
import type { ContextLike } from "./capture.ts";
import { getThumbnailerServiceConfig } from "./config.ts";
import { startThumbnailer } from "./index.ts";

let storageDir: string;

beforeAll(async () => {
	storageDir = await mkdtemp(path.join(tmpdir(), "thumb-service-"));
	await mkdir(path.join(storageDir, "elpx", "abc12345"), { recursive: true });
	await writeFile(
		path.join(storageDir, "elpx", "abc12345", "index.html"),
		"<h1>Hola</h1>",
	);
});

afterAll(async () => {
	if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

function fakeLaunch() {
	const gotos: string[] = [];
	let closed = false;
	const context: ContextLike = {
		route: async () => {},
		newPage: async () => ({
			goto: async (url) => gotos.push(url),
			evaluate: async (expression) =>
				expression.includes("innerText")
					? { textLength: 4, mediaCount: 0 }
					: true,
			addStyleTag: async () => {},
			waitForTimeout: async () => {},
			url: () => "https://elpx-thumb.invalid/index.html?nav=false",
			screenshot: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
		}),
		close: async () => {},
	};
	const browser: BrowserHandle = {
		newContext: async () => context,
		close: async () => {
			closed = true;
		},
		isConnected: () => !closed,
		onDisconnected: () => {},
	};
	return {
		launch: async () => browser,
		gotos,
		get closed() {
			return closed;
		},
	};
}

describe("startThumbnailer (#470)", () => {
	test("atiende /health y /render contra el almacenamiento y se para limpio", async () => {
		const fake = fakeLaunch();
		const service = startThumbnailer(
			{
				...getThumbnailerServiceConfig({}),
				host: "127.0.0.1",
				port: 0,
				storageDir,
				settleMs: 1,
			},
			{ launch: fake.launch, log: { info() {}, warn() {} } },
		);
		try {
			const base = `http://127.0.0.1:${service.server.port}`;
			const health = await fetch(`${base}/health`);
			expect(health.status).toBe(200);

			const ok = await fetch(`${base}/render`, {
				method: "POST",
				body: JSON.stringify({ hash: "abc12345" }),
			});
			expect(ok.status).toBe(200);
			expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
			expect(fake.gotos).toEqual([
				"https://elpx-thumb.invalid/index.html?nav=false",
			]);

			const missing = await fetch(`${base}/render`, {
				method: "POST",
				body: JSON.stringify({ hash: "deadbeef" }),
			});
			expect(missing.status).toBe(404);
		} finally {
			await service.stop();
		}
		expect(fake.closed).toBe(true);
	});

	test("avisa al arrancar si Chromium no puede lanzarse y /health lo refleja", async () => {
		const warnings: string[] = [];
		const service = startThumbnailer(
			{
				...getThumbnailerServiceConfig({}),
				host: "127.0.0.1",
				port: 0,
				storageDir,
			},
			{
				launch: async () => {
					throw new Error("No usable sandbox!\nmás detalle");
				},
				log: { info() {}, warn: (line: string) => warnings.push(line) },
			},
		);
		try {
			await service.ready;
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("Chromium no arranca: No usable sandbox!.");
			const health = await fetch(
				`http://127.0.0.1:${service.server.port}/health`,
			);
			expect(health.status).toBe(503);
		} finally {
			await service.stop();
		}
	});
});
