import { afterEach, describe, expect, test } from "bun:test";
import type { ApiClient } from "./api-client.ts";
import { withResourceVersionApi } from "./resource-version-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("resource version API", () => {
	test("lists versions without a manual publish action", async () => {
		let requestedUrl = "";
		globalThis.fetch = (async (input) => {
			requestedUrl = String(input);
			return new Response(
				JSON.stringify([
					{
						id: "v1",
						versionNumber: 1,
						isCurrent: true,
					},
				]),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const client = withResourceVersionApi({} as ApiClient);
		const versions = await client.listResourceVersions("resource 1");

		expect(requestedUrl).toBe("/api/admin/resources/resource%201/versions");
		expect(versions[0]?.versionNumber).toBe(1);
		expect("publishResourceVersion" in client).toBe(false);
		expect("changeNotes" in (versions[0] ?? {})).toBe(false);
	});

	test("restores an existing version", async () => {
		let method = "";
		globalThis.fetch = (async (_input, init) => {
			method = init?.method ?? "GET";
			return new Response(
				JSON.stringify({
					versionNumber: 3,
					restoredFromVersionNumber: 1,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const client = withResourceVersionApi({} as ApiClient);
		const result = await client.restoreResourceVersion("r1", "v1");

		expect(method).toBe("POST");
		expect(result).toEqual({
			ok: true,
			versionNumber: 3,
			restoredFromVersionNumber: 1,
		});
	});
});
