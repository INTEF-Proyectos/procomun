import { describe, expect, test } from "bun:test";
// The vendored relay is a classic script that also exposes its API on module.exports for
// tests (window assignment is guarded). reconstructProvider() is the strict-mode canonical
// URL rebuilder and is pure (no window), so it can be exercised directly here. The full
// validate() adversarial suite (userinfo / non-https / same-origin / IP / lookalike host)
// runs against the identical relay in mod_exelearning / wp-exelearning / omeka-s-exelearning.
import relay from "../../public/elpx/exe_embed_relay.js";

describe("exe_embed_relay strict-mode provider reconstruction (adversarial)", () => {
	test("rebuilds the canonical privacy-friendly URL for a valid provider id", () => {
		expect(relay.reconstructProvider("youtube", "aqz-KE-bpKQ")).toBe(
			"https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
		);
		expect(relay.reconstructProvider("vimeo", "12345")).toBe("https://player.vimeo.com/video/12345");
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
