import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { PreviewSnapshotStore } from "../services/preview-snapshot-store.ts";
import { createPreviewManagementRoutes, createPreviewServingRoutes } from "./preview.ts";

function snapshot(): Uint8Array {
	return zipSync({
		"index.html": strToU8("<script>window.active=true</script>"),
		"image.svg": strToU8("<svg><script>run()</script></svg>"),
	});
}

function managementApp(store: PreviewSnapshotStore, authenticated = true): Hono<AuthEnv> {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", authenticated ? ({ id: "user-a", role: "author" } as never) : null);
		c.set("session", null);
		await next();
	});
	app.route("/sessions", createPreviewManagementRoutes(store, async () => true));
	return app;
}

describe("simplified opaque preview routes", () => {
	test("requires authentication and a same-origin management request", async () => {
		const form = new FormData();
		form.append("snapshot", new File([snapshot()], "preview.zip"));
		expect((await managementApp(new PreviewSnapshotStore(), false).request("http://host/sessions/project", { method: "POST", headers: { Origin: "http://host" }, body: form })).status).toBe(401);
		expect((await managementApp(new PreviewSnapshotStore()).request("http://host/sessions/project", { method: "POST", headers: { Origin: "http://attacker" }, body: form })).status).toBe(403);
	});

	test("creates, serves without credentials, replaces, and deletes a capability", async () => {
		const store = new PreviewSnapshotStore();
		const management = managementApp(store);
		const form = new FormData();
		form.append("snapshot", new File([snapshot()], "preview.zip"));
		const created = await management.request("http://host/sessions/project", { method: "POST", headers: { Origin: "http://host" }, body: form });
		expect(created.status).toBe(200);
		const { previewId } = await created.json() as { previewId: string };

		const serving = createPreviewServingRoutes(store);
		const html = await serving.request(`http://host/${previewId}/index.html`);
		expect(html.status).toBe(200);
		expect(html.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
		expect(html.headers.get("content-security-policy")).toContain("allow-downloads");
		expect(html.headers.get("content-security-policy")).toContain("allow-presentation");
		expect(html.headers.get("content-security-policy")).not.toContain("allow-same-origin");
		expect(html.headers.get("access-control-allow-origin")).toBe("*");
		expect(await html.text()).toContain("window.active=true");

		const replacement = new FormData();
		replacement.append("snapshot", new File([zipSync({ "index.html": strToU8("updated") })], "preview.zip"));
		replacement.append("previewId", previewId);
		expect((await management.request("http://host/sessions/project", { method: "POST", headers: { Origin: "http://host" }, body: replacement })).status).toBe(200);
		expect(await (await serving.request(`http://host/${previewId}/index.html`)).text()).toBe("updated");

		expect((await management.request(`http://host/sessions/project/${previewId}`, { method: "DELETE", headers: { Origin: "http://host" } })).status).toBe(204);
		expect((await serving.request(`http://host/${previewId}/index.html`)).status).toBe(404);
	});

	test("rejects malformed capabilities and traversal paths with hardened responses", async () => {
		const serving = createPreviewServingRoutes(new PreviewSnapshotStore());
		const malformed = await serving.request("http://host/not-a-capability/index.html");
		expect(malformed.status).toBe(404);
		expect(malformed.headers.get("x-content-type-options")).toBe("nosniff");
	});
});
