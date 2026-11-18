import { describe, expect, test } from "bun:test";
import { getThumbnailerServiceConfig } from "./config.ts";

describe("getThumbnailerServiceConfig (#470)", () => {
	test("valores por defecto: 2 capturas, 15 s y sandbox activo", () => {
		const config = getThumbnailerServiceConfig({});
		expect(config).toMatchObject({
			host: "0.0.0.0",
			port: 3100,
			concurrency: 2,
			queueLimit: 8,
			timeoutMs: 15_000,
			settleMs: 500,
			recycleAfter: 50,
			maxImageBytes: 100 * 1024,
			maxAssetBytes: 20 * 1024 * 1024,
			chromiumSandbox: true,
			chromiumPath: null,
		});
		expect(config.storageDir).toEndWith("local-data/uploads");
	});

	test("lee el almacenamiento del servicio o, si falta, el de la API", () => {
		expect(
			getThumbnailerServiceConfig({
				THUMBNAILER_STORAGE_DIR: "/data/uploads",
				UPLOAD_STORAGE_DIR: "/otro",
			}).storageDir,
		).toBe("/data/uploads");
		expect(
			getThumbnailerServiceConfig({ UPLOAD_STORAGE_DIR: "/otro" }).storageDir,
		).toBe("/otro");
	});

	test("lee los números, acota los excesivos y descarta los no válidos", () => {
		const config = getThumbnailerServiceConfig({
			THUMBNAILER_PORT: "8080",
			THUMBNAILER_CONCURRENCY: "64",
			THUMBNAILER_TIMEOUT_MS: "abc",
			THUMBNAILER_SETTLE_MS: "0",
			THUMBNAILER_CHROMIUM_SANDBOX: "false",
			THUMBNAILER_CHROMIUM_PATH: " /usr/bin/chromium ",
		});
		expect(config.port).toBe(8080);
		expect(config.concurrency).toBe(16);
		expect(config.timeoutMs).toBe(15_000);
		expect(config.settleMs).toBe(500);
		expect(config.chromiumSandbox).toBe(false);
		expect(config.chromiumPath).toBe("/usr/bin/chromium");
	});
});
