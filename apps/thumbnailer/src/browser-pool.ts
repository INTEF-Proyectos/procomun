/**
 * Un navegador vivo para todas las capturas (#470, ADR-0046). Se relanza cada
 * `recycleAfter` usos, si se cae o si una captura lo deja sospechoso (tiempo
 * agotado, un contexto que no cierra). Un navegador retirado termina las
 * capturas que tenga en marcha y se cierra al quedar libre.
 */

import type { BrowserHandle, Launcher } from "./browser.ts";
import type { BrowserLike, CaptureOutcome } from "./capture.ts";

type Entry = {
	browser: BrowserHandle;
	uses: number;
	active: number;
	retired: boolean;
};

const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Chromium no arranca (falta el navegador, no hay sandbox posible…). No es
 * culpa del paquete: el servicio responde 503 y la API no gasta intentos.
 */
export class BrowserLaunchError extends Error {}

export class BrowserPool {
	private current: Entry | null = null;
	private launching: Promise<Entry> | null = null;
	private closing = new Set<Promise<void>>();
	launches = 0;
	/** Motivo del último arranque fallido; `null` si el último funcionó. */
	lastLaunchError: string | null = null;

	constructor(
		private readonly launch: Launcher,
		private readonly options: { recycleAfter: number },
	) {}

	private async acquire(): Promise<Entry> {
		const usable = (entry: Entry | null) =>
			entry && !entry.retired && entry.browser.isConnected() ? entry : null;
		let entry = usable(this.current);
		if (!entry) {
			if (!this.launching) {
				this.launching = this.launch()
					.catch((err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						this.lastLaunchError = message;
						throw new BrowserLaunchError(message);
					})
					.then((browser) => {
						this.launches++;
						this.lastLaunchError = null;
						const fresh: Entry = {
							browser,
							uses: 0,
							active: 0,
							retired: false,
						};
						browser.onDisconnected(() => {
							fresh.retired = true;
							if (this.current === fresh) this.current = null;
						});
						this.current = fresh;
						return fresh;
					})
					.finally(() => {
						this.launching = null;
					});
			}
			entry = await this.launching;
		}
		entry.uses++;
		entry.active++;
		if (entry.uses >= this.options.recycleAfter) entry.retired = true;
		return entry;
	}

	private release(entry: Entry, suspect: boolean): void {
		entry.active--;
		if (suspect) entry.retired = true;
		// La captura siguiente ya no lo usa; se cierra cuando quede libre.
		if (entry.retired && this.current === entry) this.current = null;
		if (!entry.retired || entry.active > 0) return;
		const closing = closeQuietly(entry.browser).finally(() => {
			this.closing.delete(closing);
		});
		this.closing.add(closing);
	}

	/** Arranca el navegador sin capturar nada, para saber pronto si funciona. */
	async warmUp(): Promise<void> {
		await this.run(async () => ({
			result: { status: "empty" },
			browserSuspect: false,
		}));
	}

	/** Ejecuta una captura con el navegador vigente. */
	async run(
		capture: (browser: BrowserLike) => Promise<CaptureOutcome>,
	): Promise<CaptureOutcome> {
		const entry = await this.acquire();
		let suspect = true;
		try {
			const outcome = await capture(entry.browser);
			suspect = outcome.browserSuspect;
			return outcome;
		} finally {
			this.release(entry, suspect);
		}
	}

	get stats() {
		return {
			launches: this.launches,
			active: this.current?.active ?? 0,
			uses: this.current?.uses ?? 0,
		};
	}

	async close(): Promise<void> {
		const entry = this.current;
		this.current = null;
		if (entry) {
			entry.retired = true;
			await closeQuietly(entry.browser);
		}
		await Promise.all([...this.closing]);
	}
}

async function closeQuietly(browser: BrowserHandle): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		browser.close().catch(() => {}),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
		}),
	]).finally(() => clearTimeout(timer));
}
