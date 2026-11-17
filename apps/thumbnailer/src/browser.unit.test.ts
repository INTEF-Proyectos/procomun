import { describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import {
	adaptBrowser,
	CHROMIUM_ARGS,
	chromiumLauncher,
	launchOptions,
} from "./browser.ts";
import { CONTEXT_OPTIONS } from "./capture.ts";

describe("launchOptions (#470)", () => {
	test("Chromium sin interfaz, con sandbox y sin resolver nombres", () => {
		expect(
			launchOptions({ chromiumSandbox: true, chromiumPath: null }),
		).toEqual({
			headless: true,
			chromiumSandbox: true,
			executablePath: undefined,
			args: CHROMIUM_ARGS,
			timeout: 30_000,
		});
		expect(CHROMIUM_ARGS).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
		expect(
			launchOptions({ chromiumSandbox: false, chromiumPath: "/usr/bin/x" }),
		).toMatchObject({ chromiumSandbox: false, executablePath: "/usr/bin/x" });
	});

	test("chromiumLauncher no lanza nada hasta que se le llama", () => {
		expect(
			typeof chromiumLauncher({ chromiumSandbox: true, chromiumPath: null }),
		).toBe("function");
	});
});

describe("adaptBrowser (#470)", () => {
	test("cierra los WebSocket y delega en Playwright", async () => {
		const calls: unknown[][] = [];
		const page = {
			goto: async (...args: unknown[]) => calls.push(["goto", ...args]),
			evaluate: async (expression: string) => {
				calls.push(["evaluate", expression]);
				return 42;
			},
			addStyleTag: async (opts: unknown) => calls.push(["addStyleTag", opts]),
			waitForTimeout: async (ms: number) => {
				calls.push(["waitForTimeout", ms]);
			},
			url: () => {
				calls.push(["url"]);
				return "https://elpx-thumb.invalid/index.html";
			},
			screenshot: async (opts: unknown) => {
				calls.push(["screenshot", opts]);
				return Buffer.from([0xff, 0xd8, 0xff]);
			},
		};
		let wsHandler: ((ws: { close(): void }) => void) | null = null;
		const context = {
			routeWebSocket: async (
				pattern: RegExp,
				handler: (ws: { close(): void }) => void,
			) => {
				calls.push(["routeWebSocket", String(pattern)]);
				wsHandler = handler;
			},
			route: async (url: string, handler: (route: unknown) => unknown) => {
				calls.push(["route", url]);
				await handler("ruta");
			},
			newPage: async () => page,
			close: async () => {
				calls.push(["context.close"]);
			},
		};
		const listeners: Array<() => void> = [];
		const browser = {
			newContext: async (opts: unknown) => {
				calls.push(["newContext", opts]);
				return context;
			},
			close: async () => {
				calls.push(["browser.close"]);
			},
			isConnected: () => true,
			on: (event: string, listener: () => void) => {
				calls.push(["on", event]);
				listeners.push(listener);
			},
		} as unknown as Browser;

		const adapted = adaptBrowser(browser);
		const ctx = await adapted.newContext(CONTEXT_OPTIONS);
		const routed: unknown[] = [];
		await ctx.route("**/*", async (route) => {
			routed.push(route);
		});
		const p = await ctx.newPage();
		await p.goto("https://elpx-thumb.invalid/", {
			waitUntil: "load",
			timeout: 5,
		});
		expect(await p.evaluate("1")).toBe(42);
		await p.addStyleTag({ content: "x" });
		await p.waitForTimeout(3);
		expect(p.url()).toBe("https://elpx-thumb.invalid/index.html");
		await p.screenshot({
			type: "jpeg",
			quality: 80,
			timeout: 1,
			animations: "disabled",
			caret: "hide",
		});
		await ctx.close();
		await adapted.close();
		adapted.onDisconnected(() => {});
		expect(adapted.isConnected()).toBe(true);

		let closedWs = false;
		(wsHandler as ((ws: { close(): void }) => void) | null)?.({
			close: () => {
				closedWs = true;
			},
		});
		expect(closedWs).toBe(true);
		expect(routed).toEqual(["ruta"]);
		expect(calls.map((call) => call[0])).toEqual([
			"newContext",
			"routeWebSocket",
			"route",
			"goto",
			"evaluate",
			"addStyleTag",
			"waitForTimeout",
			"url",
			"screenshot",
			"context.close",
			"browser.close",
			"on",
		]);
		expect(listeners).toHaveLength(1);
	});
});
