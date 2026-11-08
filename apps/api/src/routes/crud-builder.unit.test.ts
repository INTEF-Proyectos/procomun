import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { buildCrudRoutes } from "./crud-builder.ts";

describe("buildCrudRoutes", () => {
	test("applies list filters and pagination on the collection route", async () => {
		const listCalls: Record<string, unknown>[] = [];
		const routes = buildCrudRoutes({
			baseRole: "author",
			list: async (_db, opts) => {
				listCalls.push(opts);
				return { data: [], total: 0 };
			},
			getById: async () => null,
			listFilters: (_user, params) => ({ language: params.language }),
		});

		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", {
				id: "author-1",
				role: "author",
			} as AuthEnv["Variables"]["user"]);
			c.set("session", null);
			await next();
		});
		app.route("/crud", routes);

		const response = await app.request(
			"/crud?limit=5&offset=3&q=matematicas&language=es",
		);
		expect(response.status).toBe(200);
		expect(listCalls).toEqual([
			{
				limit: 5,
				offset: 3,
				search: "matematicas",
				language: "es",
			},
		]);
	});

	test("returns 404 when updating a missing entity", async () => {
		const routes = buildCrudRoutes({
			baseRole: "author",
			list: async () => ({ data: [], total: 0 }),
			getById: async () => null,
			update: async () => {},
		});

		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", {
				id: "author-1",
				role: "author",
			} as AuthEnv["Variables"]["user"]);
			c.set("session", null);
			await next();
		});
		app.route("/crud", routes);

		const response = await app.request("/crud/missing", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "nuevo" }),
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "No encontrado" });
	});

	function appWith(routes: ReturnType<typeof buildCrudRoutes>) {
		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", {
				id: "author-1",
				role: "author",
			} as AuthEnv["Variables"]["user"]);
			c.set("session", null);
			await next();
		});
		app.route("/crud", routes);
		return app;
	}

	function patch(app: Hono<AuthEnv>, body: unknown) {
		return app.request("/crud/e1", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("un error del repositorio con campo vuelve en details (#448)", async () => {
		const app = appWith(
			buildCrudRoutes({
				baseRole: "author",
				list: async () => ({ data: [], total: 0 }),
				getById: async () => ({ id: "e1" }),
				update: async () => {
					throw Object.assign(new Error("Alguna área no existe"), {
						status: 400,
						field: "knowledgeAreaIds",
					});
				},
			}),
		);
		const response = await patch(app, { knowledgeAreaIds: ["x"] });
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Alguna área no existe",
			details: [
				{ field: "knowledgeAreaIds", message: "Alguna área no existe" },
			],
		});
	});

	test("validateUpdateWith compara el cuerpo con lo guardado antes de escribir (#448)", async () => {
		let updated = false;
		const app = appWith(
			buildCrudRoutes({
				baseRole: "author",
				list: async () => ({ data: [], total: 0 }),
				getById: async () => ({ id: "e1", status: "published" }),
				update: async () => {
					updated = true;
				},
				validateUpdateWith: (entity, body) =>
					entity.status === "published" && body.clear
						? {
								valid: false,
								errors: [{ field: "clear", message: "No en publicados" }],
							}
						: { valid: true, errors: [] },
			}),
		);
		const rejected = await patch(app, { clear: true });
		expect(rejected.status).toBe(400);
		expect((await rejected.json()).details).toEqual([
			{ field: "clear", message: "No en publicados" },
		]);
		expect(updated).toBe(false);
		expect((await patch(app, { title: "otro" })).status).toBe(200);
		expect(updated).toBe(true);
	});
});
