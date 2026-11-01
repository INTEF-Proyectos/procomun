import { describe, expect, test } from "bun:test";
import { keepsAccessAfterStatusChange } from "./resource-access.ts";

const curator = { id: "curator-1", role: "curator" };
const othersResource = {
	createdBy: "author-1",
	assignedCuratorId: null,
	editorialStatus: "review",
};

describe("keepsAccessAfterStatusChange (#460)", () => {
	test("el curator que devuelve a borrador un recurso ajeno pierde el acceso", () => {
		expect(keepsAccessAfterStatusChange(curator, othersResource, "draft")).toBe(
			false,
		);
	});

	test("el curator que lo publica lo conserva", () => {
		expect(
			keepsAccessAfterStatusChange(curator, othersResource, "published"),
		).toBe(true);
	});

	test("el autor y el admin lo conservan al pasarlo a borrador", () => {
		expect(
			keepsAccessAfterStatusChange(
				{ id: "author-1", role: "author" },
				othersResource,
				"draft",
			),
		).toBe(true);
		expect(
			keepsAccessAfterStatusChange(
				{ id: "admin-1", role: "admin" },
				othersResource,
				"draft",
			),
		).toBe(true);
	});

	test("el curator conserva el acceso a su propio recurso en borrador", () => {
		expect(
			keepsAccessAfterStatusChange(
				curator,
				{ ...othersResource, createdBy: "curator-1" },
				"draft",
			),
		).toBe(true);
	});
});
