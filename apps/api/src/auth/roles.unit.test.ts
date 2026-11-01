import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "./middleware.ts";
import {
	canManageCollection,
	canManageResource,
	getCurrentUser,
	hasMinRole,
} from "./roles.ts";

describe("auth roles helpers", () => {
	test("getCurrentUser reads the user from context", async () => {
		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", {
				id: "user-1",
				role: "author",
			} as AuthEnv["Variables"]["user"]);
			c.set("session", null);
			await next();
		});
		app.get("/", (c) => c.json(getCurrentUser(c)));

		const response = await app.request("/");
		expect(await response.json()).toEqual({ id: "user-1", role: "author" });
	});

	test("hasMinRole respects the role hierarchy", () => {
		expect(hasMinRole("admin", "curator")).toBe(true);
		expect(hasMinRole("author", "curator")).toBe(false);
		expect(hasMinRole(undefined, "reader")).toBe(true);
	});

	test("canManageResource validates owner and curator/admin access", () => {
		expect(
			canManageResource(
				{ id: "author-1", role: "author" },
				{
					createdBy: "author-1",
					assignedCuratorId: null,
					editorialStatus: "draft",
				},
			),
		).toBe(true);
		// DEF-009 (#205): el curator asignado conserva el acceso tras publicar el recurso.
		expect(
			canManageResource(
				{ id: "curator-1", role: "curator" },
				{
					createdBy: "author-1",
					assignedCuratorId: "curator-1",
					editorialStatus: "published",
				},
			),
		).toBe(true);
		expect(
			canManageResource(
				{ id: "curator-1", role: "curator" },
				{
					createdBy: "author-1",
					assignedCuratorId: "curator-1",
					editorialStatus: "review",
				},
			),
		).toBe(true);
		expect(
			canManageResource(
				{ id: "curator-2", role: "curator" },
				{
					createdBy: "author-1",
					assignedCuratorId: "author-1",
					editorialStatus: "review",
				},
			),
		).toBe(true);
		expect(
			canManageResource(
				{ id: "reader-1", role: "reader" },
				{
					createdBy: "author-1",
					assignedCuratorId: "curator-1",
					editorialStatus: "review",
				},
			),
		).toBe(false);
	});

	test("canManageResource lets the assigned curator keep access after changing status (DEF-009)", () => {
		// Regresión DEF-009 (#205): un curator que toma un recurso de la cola de
		// revisión y lo pasa a draft/published/archived queda como assignedCuratorId
		// y debe poder seguir leyéndolo y gestionándolo; antes perdía el acceso (404).
		const curator = { id: "curator-1", role: "curator" };
		// #460: si lo devuelve a borrador, el borrador vuelve a ser privado del
		// autor y el curator pierde el acceso aunque sea el asignado.
		expect(
			canManageResource(curator, {
				createdBy: "author-1",
				assignedCuratorId: "curator-1",
				editorialStatus: "draft",
			}),
		).toBe(false);
		expect(
			canManageResource(curator, {
				createdBy: "author-1",
				assignedCuratorId: "curator-1",
				editorialStatus: "published",
			}),
		).toBe(true);
		expect(
			canManageResource(curator, {
				createdBy: "author-1",
				assignedCuratorId: "curator-1",
				editorialStatus: "archived",
			}),
		).toBe(true);
		// Un curator distinto al asignado no gana acceso a un recurso ya fuera de revisión.
		expect(
			canManageResource(
				{ id: "curator-2", role: "curator" },
				{
					createdBy: "author-1",
					assignedCuratorId: "curator-1",
					editorialStatus: "published",
				},
			),
		).toBe(false);
		// Sigue pudiendo trabajar cualquier recurso de la cola de revisión.
		expect(
			canManageResource(
				{ id: "curator-3", role: "curator" },
				{
					createdBy: "author-1",
					assignedCuratorId: null,
					editorialStatus: "review",
				},
			),
		).toBe(true);
	});

	test("canManageResource: un curator no gestiona borradores ajenos (#460)", () => {
		const curator = { id: "curator-1", role: "curator" };
		expect(
			canManageResource(curator, {
				createdBy: "author-1",
				assignedCuratorId: null,
				editorialStatus: "draft",
			}),
		).toBe(false);
		// Sus propios borradores sí.
		expect(
			canManageResource(curator, {
				createdBy: "curator-1",
				assignedCuratorId: null,
				editorialStatus: "draft",
			}),
		).toBe(true);
		// El admin, todos.
		expect(
			canManageResource(
				{ id: "admin-1", role: "admin" },
				{
					createdBy: "author-1",
					assignedCuratorId: null,
					editorialStatus: "draft",
				},
			),
		).toBe(true);
	});

	test("canManageCollection allows curator and admin access", () => {
		expect(
			canManageCollection(
				{ id: "curator-1", role: "curator" },
				{ curatorId: "curator-2" },
			),
		).toBe(true);
		expect(
			canManageCollection(
				{ id: "curator-1", role: "curator" },
				{ curatorId: "curator-1" },
			),
		).toBe(true);
		expect(
			canManageCollection(
				{ id: "admin-1", role: "admin" },
				{ curatorId: "curator-2" },
			),
		).toBe(true);
		expect(
			canManageCollection(
				{ id: "author-1", role: "author" },
				{ curatorId: "curator-1" },
			),
		).toBe(false);
	});
});
