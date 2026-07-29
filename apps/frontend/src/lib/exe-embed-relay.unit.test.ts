import { describe, expect, test } from "bun:test";
// The vendored relay is a classic script that also exposes its API on module.exports for
// tests (window assignment is guarded). reconstructProvider() is the strict-mode canonical
// URL rebuilder and is pure (no window), so it can be exercised directly here. The full
// validate() adversarial suite (userinfo / non-https / same-origin / IP / lookalike host)
// runs against the identical relay in mod_exelearning / wp-exelearning / omeka-s-exelearning.
import relayModule from "../../public/elpx/exe_embed_relay.js";

/** Superficie del mirror CJS de exe_embed_relay.js usada por estos tests. */
type RelayInstance = {
	checkDrift: () => number;
	dispose: () => void;
	init?: (config?: { mode: string }) => unknown;
	onMessage: (event: { source: unknown; data: unknown }) => void;
};
type RelayModule = {
	reconstructProvider: (provider: string, id: string) => string | null;
	createRelay: (config: { mode: string }) => RelayInstance;
};
const relay = relayModule as unknown as RelayModule;

describe("exe_embed_relay strict-mode provider reconstruction (adversarial)", () => {
	test("rebuilds the canonical privacy-friendly URL for a valid provider id", () => {
		expect(relay.reconstructProvider("youtube", "aqz-KE-bpKQ")).toBe(
			"https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
		);
		expect(relay.reconstructProvider("vimeo", "12345")).toBe(
			"https://player.vimeo.com/video/12345",
		);
	});

	test("rejects a malformed id that tries to carry a path/query/fragment (escape laundering)", () => {
		expect(relay.reconstructProvider("youtube", "a/b")).toBeNull();
		expect(relay.reconstructProvider("youtube", "id?x=1")).toBeNull();
		expect(relay.reconstructProvider("youtube", "../../x")).toBeNull();
		expect(relay.reconstructProvider("vimeo", "12a")).toBeNull();
	});

	test("rejects an unknown provider", () => {
		expect(relay.reconstructProvider("evil", "12345")).toBeNull();
	});
});

describe("exe_embed_relay checkDrift() wiring", () => {
	// checkDrift() re-pins overlays whose content iframe moved with no scroll/resize
	// (editor sidebar/panel toggles). Its DOM-driven assertions run against the
	// identical relay in eXe core's happy-dom suite and the shared e2e; here (no DOM
	// harness) we assert it is exported on the relay instance and that the empty-state
	// path is a no-op, which is enough to catch a dropped export or a broken early loop.
	test("is exposed on the relay instance and is a no-op with no overlays", () => {
		const r = relay.createRelay({ mode: "open" });
		expect(typeof r.checkDrift).toBe("function");
		expect(r.checkDrift()).toBe(0);
	});
});

describe("exe_embed_relay dispose() wiring", () => {
	// dispose() clears the overlays and removes the window listeners/drift timer
	// init() installs, and init() is idempotent. The full lifecycle (listeners
	// actually detached, overlays removed from the DOM) is verified against the
	// identical relay in eXe core's happy-dom suite and the shared e2e; here (no
	// DOM harness) we assert dispose is exported and that the teardown path is
	// safe with no overlays and before init(). A minimal window stub stands in for
	// the removeEventListener/clearInterval calls dispose() makes.
	test("is exported and is safe with no overlays before init()", () => {
		const r = relay.createRelay({ mode: "open" });
		expect(typeof r.dispose).toBe("function");

		const globals = globalThis as { window?: unknown };
		const priorWindow = globals.window;
		globals.window = { removeEventListener() {}, clearInterval() {} };
		try {
			// driftTimer is null and overlays is empty before init(): dispose() must
			// not throw, and a second call must stay safe (idempotent teardown).
			expect(() => r.dispose()).not.toThrow();
			expect(() => r.dispose()).not.toThrow();
		} finally {
			globals.window = priorWindow;
		}
	});
});

describe("exe_embed_relay handshake reply", () => {
	// The in-content shim never promotes an embed on its own authority: it announces
	// itself and waits to be welcomed. Without that answer the author's iframes are
	// left alone, because an unanswered placeholder is a permanent black box and this
	// code travels inside content routinely opened with no relay at all (file://, a
	// third-party page, an ePub reader). The reply is ADDRESSED: only a content frame
	// the relay actually hosts is answered, never a promoted player.
	//
	// No DOM harness here, so document.getElementsByTagName is stubbed the same way
	// the dispose() test stubs window.
	function withFrames<T>(
		frames: Array<{ contentWindow: unknown; player?: boolean }>,
		run: () => T,
	): T {
		const globals = globalThis as { document?: unknown };
		const prior = globals.document;
		globals.document = {
			getElementsByTagName: () =>
				frames.map((f) => ({
					contentWindow: f.contentWindow,
					getAttribute: (name: string) =>
						name === "data-exe-embed-player" && f.player ? "1" : null,
				})),
		};
		try {
			return run();
		} finally {
			globals.document = prior;
		}
	}

	test("welcomes a hello from a content frame it hosts", () => {
		const posted: unknown[] = [];
		const contentWindow = {
			postMessage: (msg: unknown) => {
				posted.push(msg);
			},
		};

		withFrames([{ contentWindow }], () => {
			const r = relay.createRelay({ mode: "open" });
			r.onMessage({
				source: contentWindow,
				data: { type: "exe-embed", action: "hello" },
			});
		});

		expect(posted).toEqual([{ type: "exe-embed", action: "welcome" }]);
	});

	test("ignores a hello from a window it does not host", () => {
		const posted: unknown[] = [];
		const stranger = {
			postMessage: (msg: unknown) => {
				posted.push(msg);
			},
		};
		const hosted = { postMessage: () => {} };

		withFrames([{ contentWindow: hosted }], () => {
			const r = relay.createRelay({ mode: "open" });
			r.onMessage({
				source: stranger,
				data: { type: "exe-embed", action: "hello" },
			});
		});

		expect(posted).toEqual([]);
	});

	test("never welcomes a promoted player frame", () => {
		const posted: unknown[] = [];
		const playerWindow = {
			postMessage: (msg: unknown) => {
				posted.push(msg);
			},
		};

		withFrames([{ contentWindow: playerWindow, player: true }], () => {
			const r = relay.createRelay({ mode: "open" });
			r.onMessage({
				source: playerWindow,
				data: { type: "exe-embed", action: "hello" },
			});
		});

		expect(posted).toEqual([]);
	});
});
