import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import { apiResourceRoutes } from "../api-resources.ts";
import { adminRoutes } from "./index.ts";

// Transiciones editoriales por rol a través de la API (#506): el editor
// publica directamente y no envía a revisión; los demás roles no cambian.

const completeResource = {
	title: "Recurso del flujo editorial",
	description: "Descripción completa para poder cambiar de estado",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	author: "Autora de prueba",
	// Con #448 hace falta un área para salir de borrador; hasta entonces se
	// ignora.
	knowledgeAreaIds: ["matematicas"],
};

type App = Hono<AuthEnv>;

async function sessionUser(role: string) {
	const id = `${role}-${crypto.randomUUID()}`;
	const user = { id, role, email: `${id}@local.invalid`, name: `User ${id}` };
	await repo.ensureUser(getDb().db, user);
	return user;
}

async function adminAppFor(role: string): Promise<App> {
	const user = await sessionUser(role);
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", user as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	return app;
}

async function createComplete(app: App): Promise<string> {
	const res = await app.request("/api/admin/resources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(completeResource),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

function changeStatus(app: App, id: string, status: string) {
	return app.request(`/api/admin/resources/${id}/status`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status }),
	});
}

async function storedStatus(id: string) {
	return (await repo.getResourceById(getDb().db, id))?.editorialStatus;
}

describe("PATCH /api/admin/resources/:id/status — editor (#506)", () => {
	test("rechaza enviar a revisión y deja el recurso en borrador", async () => {
		const app = await adminAppFor("editor");
		const id = await createComplete(app);

		const res = await changeStatus(app, id, "review");

		expect(res.status).toBe(403);
		const body = (await res.json()) as {
			error: string;
			details: { field: string; message: string }[];
		};
		expect(body.error).toBe("Transición no permitida");
		expect(body.details[0]?.field).toBe("status");
		expect(await storedStatus(id)).toBe("draft");
	});

	test("publica directamente un borrador completo", async () => {
		const app = await adminAppFor("editor");
		const id = await createComplete(app);

		const res = await changeStatus(app, id, "published");

		expect(res.status).toBe(200);
		expect(await storedStatus(id)).toBe("published");
	});

	test("las validaciones de publicación se mantienen", async () => {
		const app = await adminAppFor("editor");
		// El borrador vacío del alta rápida no tiene descripción.
		const created = await app.request("/api/admin/resources/draft", {
			method: "POST",
		});
		const { id } = (await created.json()) as { id: string };

		const res = await changeStatus(app, id, "published");

		expect(res.status).toBe(400);
		expect(await storedStatus(id)).toBe("draft");
	});
});

describe("PATCH /api/admin/resources/:id/status — los demás roles no cambian (#506)", () => {
	test("author envía a revisión y no publica directamente", async () => {
		const app = await adminAppFor("author");
		const toReview = await createComplete(app);
		const toPublish = await createComplete(app);

		expect((await changeStatus(app, toReview, "review")).status).toBe(200);
		expect(await storedStatus(toReview)).toBe("review");
		expect((await changeStatus(app, toPublish, "published")).status).toBe(403);
		expect(await storedStatus(toPublish)).toBe("draft");
	});

	for (const role of ["curator", "admin"]) {
		test(`${role} puede enviar a revisión o publicar su borrador`, async () => {
			const app = await adminAppFor(role);
			const toReview = await createComplete(app);
			const toPublish = await createComplete(app);

			expect((await changeStatus(app, toReview, "review")).status).toBe(200);
			expect(await storedStatus(toReview)).toBe("review");
			expect((await changeStatus(app, toPublish, "published")).status).toBe(
				200,
			);
			expect(await storedStatus(toPublish)).toBe("published");
		});
	}

	test("curator aprueba lo que un author envía a revisión", async () => {
		const author = await adminAppFor("author");
		const id = await createComplete(author);
		expect((await changeStatus(author, id, "review")).status).toBe(200);

		const curator = await adminAppFor("curator");
		expect((await changeStatus(curator, id, "published")).status).toBe(200);
		expect(await storedStatus(id)).toBe("published");
	});
});

describe("POST /api/v1/publish/resources en revisión (#506)", () => {
	async function tokenAppFor(role: string) {
		const user = await sessionUser(role);
		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", user as AuthEnv["Variables"]["user"]);
			c.set("session", null);
			await next();
		});
		app.route("/api/v1/publish/resources", apiResourceRoutes);
		return { app, userId: user.id };
	}

	function createVia(app: App, editorialStatus?: string) {
		return app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...completeResource, editorialStatus }),
		});
	}

	async function resourcesCreatedBy(userId: string) {
		return (await repo.listResources(getDb().db, { createdBy: userId })).total;
	}

	test("el editor no puede crear un recurso en revisión", async () => {
		const { app, userId } = await tokenAppFor("editor");

		const res = await createVia(app, "review");

		expect(res.status).toBe(403);
		expect(await resourcesCreatedBy(userId)).toBe(0);
	});

	test("el editor sigue creando borradores", async () => {
		const { app } = await tokenAppFor("editor");
		const res = await createVia(app);

		expect(res.status).toBe(201);
		expect(
			((await res.json()) as { editorialStatus: string }).editorialStatus,
		).toBe("draft");
	});

	for (const role of ["author", "curator", "admin"]) {
		test(`${role} sigue pudiendo crear en revisión`, async () => {
			const { app } = await tokenAppFor(role);
			const res = await createVia(app, "review");

			expect(res.status).toBe(201);
			expect(
				((await res.json()) as { editorialStatus: string }).editorialStatus,
			).toBe("review");
		});
	}
});
