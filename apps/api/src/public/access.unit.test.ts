import { describe, expect, test } from "bun:test";
import { canViewResource } from "./access.ts";

describe("public access", () => {
	test("published resources are visible to anonymous users", () => {
		expect(
			canViewResource(null, {
				editorialStatus: "published",
				createdBy: "author-1",
			}),
		).toBe(true);
	});

	test("draft resources are hidden from anonymous users", () => {
		expect(
			canViewResource(null, {
				editorialStatus: "draft",
				createdBy: "author-1",
			}),
		).toBe(false);
	});

	test("owners can view their non-published resources", () => {
		expect(
			canViewResource(
				{ id: "author-1", role: "author" },
				{
					editorialStatus: "review",
					createdBy: "author-1",
				},
			),
		).toBe(true);
	});

	test("curators can view non-published resources from other users", () => {
		expect(
			canViewResource(
				{ id: "curator-1", role: "curator" },
				{
					editorialStatus: "review",
					createdBy: "author-1",
				},
			),
		).toBe(true);
	});

	test("un curator no ve borradores ajenos (#460)", () => {
		expect(
			canViewResource(
				{ id: "curator-1", role: "curator" },
				{ editorialStatus: "draft", createdBy: "author-1" },
			),
		).toBe(false);
		// Ni aunque fuera el curator que lo devolvió a borrador.
		expect(
			canViewResource(
				{ id: "curator-1", role: "curator" },
				{
					editorialStatus: "draft",
					createdBy: "author-1",
					assignedCuratorId: "curator-1",
				},
			),
		).toBe(false);
	});

	test("un curator ve sus propios borradores y los ajenos que no son borrador (#460)", () => {
		const curator = { id: "curator-1", role: "curator" };
		expect(
			canViewResource(curator, {
				editorialStatus: "draft",
				createdBy: "curator-1",
			}),
		).toBe(true);
		for (const editorialStatus of ["review", "archived"]) {
			expect(
				canViewResource(curator, { editorialStatus, createdBy: "author-1" }),
			).toBe(true);
		}
	});

	test("el admin ve los borradores de cualquiera (#460)", () => {
		expect(
			canViewResource(
				{ id: "admin-1", role: "admin" },
				{ editorialStatus: "draft", createdBy: "author-1" },
			),
		).toBe(true);
	});

	test("un author o editor no ve recursos ajenos sin publicar", () => {
		for (const role of ["author", "editor"]) {
			expect(
				canViewResource(
					{ id: "user-2", role },
					{ editorialStatus: "review", createdBy: "author-1" },
				),
			).toBe(false);
		}
	});
});
