/**
 * Chromium de Playwright adaptado a las interfaces mínimas de `capture.ts`
 * (#470, ADR-0046). Es el único fichero que importa Playwright.
 */
import type { Browser, LaunchOptions } from "playwright-core";
import type { BrowserLike, ContextLike, PageLike } from "./capture.ts";

export interface BrowserHandle extends BrowserLike {
	close(): Promise<void>;
	isConnected(): boolean;
	onDisconnected(listener: () => void): void;
}

export type Launcher = () => Promise<BrowserHandle>;

/**
 * Defensa en profundidad, además del interceptor y de la red interna del
 * contenedor: ningún nombre se resuelve y WebRTC no puede abrir UDP.
 */
export const CHROMIUM_ARGS = [
	"--host-resolver-rules=MAP * ~NOTFOUND",
	"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
	"--webrtc-ip-handling-policy=disable_non_proxied_udp",
	"--no-pings",
	"--disable-domain-reliability",
];

export function launchOptions(config: {
	chromiumSandbox: boolean;
	chromiumPath: string | null;
}): LaunchOptions {
	return {
		headless: true,
		chromiumSandbox: config.chromiumSandbox,
		executablePath: config.chromiumPath ?? undefined,
		args: CHROMIUM_ARGS,
		timeout: 30_000,
	};
}

export function adaptBrowser(browser: Browser): BrowserHandle {
	return {
		async newContext(options): Promise<ContextLike> {
			const context = await browser.newContext(options);
			// page.route no ve los WebSocket: se cierran todos.
			await context.routeWebSocket(/.*/, (ws) => ws.close());
			return {
				route: (url, handler) => context.route(url, (route) => handler(route)),
				async newPage(): Promise<PageLike> {
					const page = await context.newPage();
					return {
						goto: (url, opts) => page.goto(url, opts),
						evaluate: (expression) => page.evaluate(expression),
						addStyleTag: (opts) => page.addStyleTag(opts),
						waitForTimeout: (ms) => page.waitForTimeout(ms),
						url: () => page.url(),
						screenshot: (opts) => page.screenshot(opts),
					};
				},
				close: () => context.close(),
			};
		},
		close: () => browser.close(),
		isConnected: () => browser.isConnected(),
		onDisconnected(listener) {
			browser.on("disconnected", listener);
		},
	};
}

export function chromiumLauncher(config: {
	chromiumSandbox: boolean;
	chromiumPath: string | null;
}): Launcher {
	return async () => {
		const { chromium } = await import("playwright-core");
		return adaptBrowser(await chromium.launch(launchOptions(config)));
	};
}
