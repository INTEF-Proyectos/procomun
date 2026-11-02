import { describe, expect, test } from "bun:test";
import { KNOWLEDGE_AREA_MESSAGES } from "@procomun/db/knowledge-areas";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { adminRoutes } from "./index.ts";

function appAs(mockUser: Record<string, unknown>) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	return app;
}

function send(
	app: ReturnType<typeof appAs>,
	method: string,
	path: string,
	body?: unknown,
) {
	return app.request(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const author = appAs({ id: "author-areas", role: "author" });
const curator = appAs({
	id: "curator-areas",
	role: "curator",
	email: "curator-areas@test.com",
});

describe("Gestión de áreas de conocimiento (#448)", () => {
	test("un author no puede consultar ni gestionar el catálogo", async () => {
		expect(
			(await send(author, "GET", "/api/admin/knowledge-areas")).status,
		).toBe(403);
		expect(
			(
				await send(author, "POST", "/api/admin/knowledge-areas", {
					label: "Bloqueada",
					blockId: "artes",
				})
			).status,
		).toBe(403);
		expect(
			(
				await send(author, "PATCH", "/api/admin/knowledge-areas/musica", {
					active: false,
				})
			).status,
		).toBe(403);
	});

	test("el curator ve bloques, áreas (también inactivas) y familias", async () => {
		const res = await send(curator, "GET", "/api/admin/knowledge-areas");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			blocks: Array<{ id: string }>;
			areas: Array<{ id: string; blockId: string }>;
			professionalFamilies: Array<{ id: string }>;
		};
		expect(body.blocks).toHaveLength(9);
		expect(body.professionalFamilies).toHaveLength(28);
		expect(body.areas.find((area) => area.id === "quimica")?.blockId).toBe(
			"ciencias",
		);
	});

	test("el curator crea un área y no la duplica", async () => {
		const label = `Cine ${crypto.randomUUID().slice(0, 8)}`;
		const created = await send(curator, "POST", "/api/admin/knowledge-areas", {
			label,
			description: "Lenguaje cinematográfico",
			blockId: "artes",
		});
		expect(created.status).toBe(201);
		const area = (await created.json()) as { id: string; label: string };
		expect(area.label).toBe(label);

		const duplicate = await send(
			curator,
			"POST",
			"/api/admin/knowledge-areas",
			{
				label: label.toUpperCase(),
				blockId: "humanidades",
			},
		);
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({
			error: KNOWLEDGE_AREA_MESSAGES.duplicate,
			area: { id: area.id },
		});

		const badBlock = await send(curator, "POST", "/api/admin/knowledge-areas", {
			label: `${label} 2`,
			blockId: "inventado",
		});
		expect(badBlock.status).toBe(400);
	});

	test("el curator edita, mueve de bloque y desactiva sin borrar", async () => {
		const label = `Oratoria ${crypto.randomUUID().slice(0, 8)}`;
		const created = await send(curator, "POST", "/api/admin/knowledge-areas", {
			label,
			blockId: "lenguas",
		});
		const { id } = (await created.json()) as { id: string };

		const moved = await send(
			curator,
			"PATCH",
			`/api/admin/knowledge-areas/${id}`,
			{
				label: `${label} y debate`,
				blockId: "humanidades",
				active: false,
			},
		);
		expect(moved.status).toBe(200);
		expect(await moved.json()).toMatchObject({
			id,
			label: `${label} y debate`,
			blockId: "humanidades",
			active: false,
		});

		const list = (await (
			await send(curator, "GET", "/api/admin/knowledge-areas")
		).json()) as { areas: Array<{ id: string; active: boolean }> };
		expect(list.areas.find((area) => area.id === id)?.active).toBe(false);

		expect(
			(
				await send(curator, "PATCH", "/api/admin/knowledge-areas/no-existe", {
					active: true,
				})
			).status,
		).toBe(404);
		expect(
			(
				await send(curator, "PATCH", `/api/admin/knowledge-areas/${id}`, {
					active: "no",
				})
			).status,
		).toBe(400);
		expect(
			(await send(curator, "DELETE", `/api/admin/knowledge-areas/${id}`))
				.status,
		).toBe(404);
	});
});
