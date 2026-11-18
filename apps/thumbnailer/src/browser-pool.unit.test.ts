import { describe, expect, test } from "bun:test";
import type { BrowserHandle } from "./browser.ts";
import { BrowserLaunchError, BrowserPool } from "./browser-pool.ts";
import type { CaptureOutcome } from "./capture.ts";

const OK: CaptureOutcome = {
	result: { status: "empty" },
	browserSuspect: false,
};
const SUSPECT: CaptureOutcome = {
	result: { status: "timeout", message: "x" },
	browserSuspect: true,
};

function fakeLauncher() {
	const browsers: Array<
		BrowserHandle & { closed: boolean; disconnect(): void; id: number }
	> = [];
	const launch = async () => {
		let connected = true;
		const listeners: Array<() => void> = [];
		const browser = {
			id: browsers.length + 1,
			closed: false,
			async newContext(): Promise<never> {
				throw new Error("no se usa");
			},
			async close() {
				browser.closed = true;
				connected = false;
			},
			isConnected: () => connected,
			onDisconnected(listener: () => void) {
				listeners.push(listener);
			},
			disconnect() {
				connected = false;
				for (const listener of listeners) listener();
			},
		};
		browsers.push(browser);
		return browser;
	};
	return { launch, browsers };
}

describe("BrowserPool (#470)", () => {
	test("reutiliza el navegador y lo relanza cada N capturas", async () => {
		const { launch, browsers } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 2 });
		const used: number[] = [];
		const capture = async (browser: unknown) => {
			used.push((browser as { id: number }).id);
			return OK;
		};

		await pool.run(capture);
		await pool.run(capture);
		await pool.run(capture);

		expect(used).toEqual([1, 1, 2]);
		expect(browsers[0]?.closed).toBe(true);
		expect(browsers[1]?.closed).toBe(false);
		expect(pool.launches).toBe(2);
	});

	test("una captura sospechosa retira el navegador", async () => {
		const { launch, browsers } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 50 });

		await pool.run(async () => SUSPECT);
		await pool.run(async () => OK);

		expect(browsers.map((b) => b.closed)).toEqual([true, false]);
	});

	test("si la captura lanza, también se retira", async () => {
		const { launch, browsers } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 50 });
		await expect(
			pool.run(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(browsers[0]?.closed).toBe(true);
	});

	test("un navegador caído se relanza en la siguiente captura", async () => {
		const { launch, browsers } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 50 });
		await pool.run(async () => OK);
		browsers[0]?.disconnect();
		await pool.run(async () => OK);
		expect(pool.launches).toBe(2);
	});

	test("las capturas simultáneas comparten un solo arranque", async () => {
		const { launch } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 50 });
		await Promise.all([
			pool.run(async () => OK),
			pool.run(async () => OK),
			pool.run(async () => OK),
		]);
		expect(pool.launches).toBe(1);
	});

	test("un navegador retirado termina la captura en curso antes de cerrarse", async () => {
		const { launch, browsers } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 50 });
		let finish: () => void = () => {};
		const slow = pool.run(
			() =>
				new Promise<CaptureOutcome>((resolve) => {
					finish = () => resolve(OK);
				}),
		);
		await Bun.sleep(1);
		await pool.run(async () => SUSPECT);
		expect(browsers[0]?.closed).toBe(false);
		expect(pool.stats.active).toBe(0);
		finish();
		await slow;
		await Bun.sleep(1);
		expect(browsers[0]?.closed).toBe(true);
	});

	test("close cierra el navegador vigente", async () => {
		const { launch, browsers } = fakeLauncher();
		const pool = new BrowserPool(launch, { recycleAfter: 50 });
		await pool.run(async () => OK);
		expect(pool.stats).toEqual({ launches: 1, active: 0, uses: 1 });
		await pool.close();
		expect(browsers[0]?.closed).toBe(true);
		await pool.close();
	});

	test("si Chromium no arranca lo dice, y lo olvida cuando vuelve a arrancar", async () => {
		const { launch } = fakeLauncher();
		let fail = true;
		const pool = new BrowserPool(
			async () => {
				if (fail) throw new Error("No usable sandbox!");
				return launch();
			},
			{ recycleAfter: 50 },
		);

		await expect(pool.warmUp()).rejects.toBeInstanceOf(BrowserLaunchError);
		expect(pool.lastLaunchError).toBe("No usable sandbox!");

		fail = false;
		await pool.warmUp();
		expect(pool.lastLaunchError).toBeNull();
		expect(pool.launches).toBe(1);
	});
});
