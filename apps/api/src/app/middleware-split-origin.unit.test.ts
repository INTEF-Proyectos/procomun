import { describe, expect, test } from "bun:test";
import { validatePreviewManagementRequest } from "./middleware.ts";

const managementPath =
	"/api/v1/preview-session/756f4e31-18e6-4f16-b868-516c5b945d8b/assets";

describe("preview management in split deployments", () => {
	test("accepts the origin that serves the editor and management API", () => {
		expect(
			validatePreviewManagementRequest({
				method: "POST",
				path: managementPath,
				origin: "http://api.test",
				secFetchSite: "same-origin",
				managementUrl: "http://api.test/api/auth",
			}),
		).toBeNull();
	});

	test("rejects a different parent application origin", () => {
		expect(
			validatePreviewManagementRequest({
				method: "POST",
				path: managementPath,
				origin: "http://frontend.test",
				secFetchSite: "same-origin",
				managementUrl: "http://api.test/api/auth",
			}),
		).toMatch(/same-origin/);
	});
});
