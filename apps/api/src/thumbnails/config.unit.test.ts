import { describe, expect, test } from "bun:test";
import { getThumbnailerConfig } from "./config.ts";

describe("getThumbnailerConfig (#470)", () => {
	test("sin THUMBNAILER_URL el bucle no se activa", () => {
		const config = getThumbnailerConfig({ NODE_ENV: "production" });
		expect(config.enabled).toBe(false);
		expect(config.disabledReason).toBe("sin THUMBNAILER_URL");
		expect(config.url).toBeNull();
	});

	test("con la URL se activa con los valores por defecto", () => {
		expect(
			getThumbnailerConfig({
				NODE_ENV: "production",
				THUMBNAILER_URL: "http://thumbnailer:3100/",
			}),
		).toEqual({
			enabled: true,
			disabledReason: null,
			url: "http://thumbnailer:3100",
			concurrency: 2,
			pollIntervalMs: 15_000,
			requestTimeoutMs: 60_000,
			maxAttempts: 3,
			retryBaseMs: 60_000,
			staleAfterMs: 600_000,
			unavailablePauseMs: 60_000,
		});
	});

	test("nunca corre en los tests ni si se desactiva a mano", () => {
		const url = "http://thumbnailer:3100";
		expect(
			getThumbnailerConfig({ NODE_ENV: "test", THUMBNAILER_URL: url }).enabled,
		).toBe(false);
		const disabled = getThumbnailerConfig({
			THUMBNAILER_URL: url,
			THUMBNAILER_DISABLED: "true",
		});
		expect(disabled.enabled).toBe(false);
		expect(disabled.disabledReason).toBe("THUMBNAILER_DISABLED=true");
	});

	test("rechaza una URL que no es http(s)", () => {
		for (const value of ["file:///etc/passwd", "no es una url"]) {
			const config = getThumbnailerConfig({ THUMBNAILER_URL: value });
			expect(config.enabled).toBe(false);
			expect(config.disabledReason).toBe(
				"THUMBNAILER_URL no es una URL http(s)",
			);
		}
	});

	test("lee los números y descarta los no válidos o fuera de rango", () => {
		const config = getThumbnailerConfig({
			THUMBNAILER_URL: "http://t:1",
			THUMBNAILER_CONCURRENCY: "4",
			THUMBNAILER_POLL_INTERVAL_MS: "-1",
			THUMBNAILER_MAX_ATTEMPTS: "99",
			THUMBNAILER_RETRY_BASE_MS: "1.5",
			THUMBNAILER_STALE_AFTER_MS: "1000",
		});
		expect(config.concurrency).toBe(4);
		expect(config.pollIntervalMs).toBe(15_000);
		expect(config.maxAttempts).toBe(10);
		expect(config.retryBaseMs).toBe(60_000);
		expect(config.staleAfterMs).toBe(1000);
	});
});
