import { describe, expect, test } from "bun:test";
import {
	KNOWLEDGE_AREA_BLOCKS,
	KNOWLEDGE_AREA_MESSAGES,
	PROFESSIONAL_FAMILIES,
} from "@procomun/db/knowledge-areas";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { adminRoutes } from "./admin/index.ts";
import { apiResourceRoutes } from "./api-resources.ts";
import { knowledgeAreaRoutes } from "./knowledge-areas.ts";
import { publicRoutes } from "./public.ts";

/**
 * Áreas de conocimiento y familias profesionales en el recurso (PR 2 de
 * #448): catálogo público, alta y edición, paso a revisión y buscador.
 */
const db = () => getDb().db;

function appAs(mockUser: Record<string, unknown> | null) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	app.route("/api/v1/knowledge-areas", knowledgeAreaRoutes);
	app.route("/api/v1/publish/resources", apiResourceRoutes);
	app.route("/api/v1", publicRoutes);
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

const admin = appAs({ id: "1", role: "admin" });
const anonymous = appAs(null);
const fp = [{ categoryId: "formacion-profesional", optionId: null }];

function resourceBody(extra: Record<string, unknown> = {}) {
	return {
		title: `Áreas ${crypto.randomUUID()}`,
		description: "Recurso con áreas de conocimiento",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		author: "Autora de prueba",
		...extra,
	};
}

async function createAsAdmin(extra: Record<string, unknown> = {}) {
	const res = await send(
		admin,
		"POST",
		"/api/admin/resources",
		resourceBody(extra),
	);
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; slug: string };
}

describe("catálogo público de áreas (#448)", () => {
	test("sin sesión devuelve bloques, áreas con su estado y familias", async () => {
		await repo.updateKnowledgeArea(db(), "efemerides", { active: false });
		try {
			const res = await anonymous.request("/api/v1/knowledge-areas");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.blocks).toEqual(KNOWLEDGE_AREA_BLOCKS);
			expect(body.professionalFamilies).toEqual(PROFESSIONAL_FAMILIES);
			// Las inactivas siguen sirviendo para filtrar: van marcadas.
			expect(
				body.areas.find((area: { id: string }) => area.id === "efemerides"),
			).toEqual({
				id: "efemerides",
				label: "Efemérides",
				blockId: "transversales",
				active: false,
			});
			// Sin datos del panel: ni recuentos ni descripciones internas.
			expect(body.areas[0]).not.toHaveProperty("usageCount");
		} finally {
			await repo.updateKnowledgeArea(db(), "efemerides", { active: true });
		}
	});
});

describe("áreas y familias en el alta y la edición (#448)", () => {
	test("el alta guarda áreas y familias y la edición las devuelve", async () => {
		const { id } = await createAsAdmin({
			educationalAreas: fp,
			knowledgeAreaIds: ["ingles"],
			professionalFamilyIds: ["hosteleria-y-turismo"],
		});
		const detail = await (
			await admin.request(`/api/admin/resources/${id}`)
		).json();
		expect(detail.knowledgeAreas.map((a: { id: string }) => a.id)).toEqual([
			"ingles",
		]);
		expect(detail.professionalFamilies).toEqual([
			{ id: "hosteleria-y-turismo", label: "Hostelería y Turismo" },
		]);
	});

	test("rechaza más de 3 áreas, un área desconocida y familias sin FP", async () => {
		const tooMany = await send(
			admin,
			"POST",
			"/api/admin/resources",
			resourceBody({
				knowledgeAreaIds: ["fisica", "quimica", "biologia", "geologia"],
			}),
		);
		expect(tooMany.status).toBe(400);
		expect((await tooMany.json()).details).toEqual([
			{ field: "knowledgeAreaIds", message: KNOWLEDGE_AREA_MESSAGES.max },
		]);

		const unknown = await send(
			admin,
			"POST",
			"/api/admin/resources",
			resourceBody({ knowledgeAreaIds: ["inventada"] }),
		);
		expect(unknown.status).toBe(400);
		expect((await unknown.json()).details).toEqual([
			{
				field: "knowledgeAreaIds",
				message: KNOWLEDGE_AREA_MESSAGES.unknownArea,
			},
		]);

		const noFp = await send(
			admin,
			"POST",
			"/api/admin/resources",
			resourceBody({ professionalFamilyIds: ["sanidad"] }),
		);
		expect(noFp.status).toBe(400);
		expect((await noFp.json()).details[0].field).toBe("professionalFamilyIds");
	});

	test("un área desactivada no se puede elegir, pero se conserva al editar", async () => {
		const { id } = await createAsAdmin({ knowledgeAreaIds: ["ajedrez"] });
		await repo.updateKnowledgeArea(db(), "ajedrez", { active: false });
		try {
			const kept = await send(admin, "PATCH", `/api/admin/resources/${id}`, {
				knowledgeAreaIds: ["ajedrez", "matematicas"],
			});
			expect(kept.status).toBe(200);

			const other = await createAsAdmin();
			const rejected = await send(
				admin,
				"PATCH",
				`/api/admin/resources/${other.id}`,
				{ knowledgeAreaIds: ["ajedrez"] },
			);
			expect(rejected.status).toBe(400);
			expect((await rejected.json()).details).toEqual([
				{
					field: "knowledgeAreaIds",
					message: KNOWLEDGE_AREA_MESSAGES.inactiveArea,
				},
			]);
		} finally {
			await repo.updateKnowledgeArea(db(), "ajedrez", { active: true });
		}
	});

	test("quitar FP en la edición borra las familias", async () => {
		const { id } = await createAsAdmin({
			educationalAreas: fp,
			professionalFamilyIds: ["sanidad"],
		});
		const res = await send(admin, "PATCH", `/api/admin/resources/${id}`, {
			educationalAreas: [{ categoryId: "bachillerato", optionId: null }],
			professionalFamilyIds: [],
		});
		expect(res.status).toBe(200);
		expect(await repo.listResourceProfessionalFamilies(db(), id)).toEqual([]);
	});
});

describe("al menos un área para salir de borrador (#448)", () => {
	test("enviar a revisión y publicar sin áreas → 400 con el campo", async () => {
		const { id } = await createAsAdmin();
		for (const status of ["review", "published"]) {
			const res = await send(
				admin,
				"PATCH",
				`/api/admin/resources/${id}/status`,
				{
					status,
				},
			);
			expect(res.status).toBe(400);
			expect((await res.json()).details).toEqual([
				{
					field: "knowledgeAreaIds",
					message: KNOWLEDGE_AREA_MESSAGES.required,
				},
			]);
		}

		await send(admin, "PATCH", `/api/admin/resources/${id}`, {
			knowledgeAreaIds: ["quimica"],
		});
		const review = await send(
			admin,
			"PATCH",
			`/api/admin/resources/${id}/status`,
			{ status: "review" },
		);
		expect(review.status).toBe(200);
	});

	test("un recurso en revisión no puede quedarse sin áreas al editarlo", async () => {
		const { id } = await createAsAdmin({ knowledgeAreaIds: ["quimica"] });
		await send(admin, "PATCH", `/api/admin/resources/${id}/status`, {
			status: "review",
		});
		const res = await send(admin, "PATCH", `/api/admin/resources/${id}`, {
			title: "No debe guardarse",
			knowledgeAreaIds: [],
		});
		expect(res.status).toBe(400);
		expect((await res.json()).details).toEqual([
			{
				field: "knowledgeAreaIds",
				message: KNOWLEDGE_AREA_MESSAGES.requiredWhilePublished,
			},
		]);
		expect((await repo.getResourceById(db(), id))?.title).not.toBe(
			"No debe guardarse",
		);
	});

	test("la API de publicación exige un área para crear en revisión", async () => {
		const withoutArea = await send(
			admin,
			"POST",
			"/api/v1/publish/resources",
			resourceBody({ editorialStatus: "review" }),
		);
		expect(withoutArea.status).toBe(400);
		expect((await withoutArea.json()).details).toEqual([
			{
				field: "knowledgeAreaIds",
				message: KNOWLEDGE_AREA_MESSAGES.required,
			},
		]);

		const draft = await send(
			admin,
			"POST",
			"/api/v1/publish/resources",
			resourceBody(),
		);
		expect(draft.status).toBe(201);

		const review = await send(
			admin,
			"POST",
			"/api/v1/publish/resources",
			resourceBody({
				editorialStatus: "review",
				knowledgeAreaIds: ["fisica"],
			}),
		);
		expect(review.status).toBe(201);
		const { id } = await review.json();
		const status = await (
			await admin.request(`/api/v1/publish/resources/${id}`)
		).json();
		expect(status.editorialStatus).toBe("review");
		expect(status.knowledgeAreas.map((a: { id: string }) => a.id)).toEqual([
			"fisica",
		]);
		expect(status.professionalFamilies).toEqual([]);

		// En revisión, la edición por la API tampoco puede dejarlo sin áreas.
		const cleared = await send(
			admin,
			"PUT",
			`/api/v1/publish/resources/${id}`,
			{ knowledgeAreaIds: [] },
		);
		expect(cleared.status).toBe(400);
		expect((await cleared.json()).details[0].message).toBe(
			KNOWLEDGE_AREA_MESSAGES.requiredWhilePublished,
		);
	});

	test("la API de publicación devuelve 400 con el campo si un área no existe", async () => {
		const created = await send(
			admin,
			"POST",
			"/api/v1/publish/resources",
			resourceBody({ knowledgeAreaIds: ["inventada"] }),
		);
		expect(created.status).toBe(400);
		expect((await created.json()).details).toEqual([
			{
				field: "knowledgeAreaIds",
				message: KNOWLEDGE_AREA_MESSAGES.unknownArea,
			},
		]);

		const draft = await (
			await send(admin, "POST", "/api/v1/publish/resources", resourceBody())
		).json();
		const updated = await send(
			admin,
			"PUT",
			`/api/v1/publish/resources/${draft.id}`,
			{ professionalFamilyIds: ["sanidad"] },
		);
		expect(updated.status).toBe(400);
		expect((await updated.json()).details).toEqual([
			{
				field: "professionalFamilyIds",
				message: KNOWLEDGE_AREA_MESSAGES.familyRequiresFp,
			},
		]);
	});
});

describe("buscador por área y familia (#448)", () => {
	test("varias áreas o familias suman; etapa, área y familia se combinan", async () => {
		const marker = crypto.randomUUID().slice(0, 8);
		const publish = async (extra: Record<string, unknown>) => {
			const { id, slug } = await createAsAdmin({
				title: `Buscador ${marker} ${crypto.randomUUID()}`,
				...extra,
			});
			await repo.updateEditorialStatus(db(), id, "published", "1");
			return { id, slug };
		};
		const hosteleria = await publish({
			educationalAreas: fp,
			knowledgeAreaIds: ["ingles"],
			professionalFamilyIds: ["hosteleria-y-turismo"],
		});
		const sanidad = await publish({
			educationalAreas: fp,
			knowledgeAreaIds: ["ingles"],
			professionalFamilyIds: ["sanidad"],
		});
		const quimica = await publish({ knowledgeAreaIds: ["quimica"] });

		const ids = async (query: string) => {
			const res = await anonymous.request(
				`/api/v1/resources?q=${marker}&${query}`,
			);
			expect(res.status).toBe(200);
			return ((await res.json()).data as Array<{ id: string }>)
				.map((row) => row.id)
				.sort();
		};

		expect(await ids("knowledgeAreas=ingles,quimica")).toEqual(
			[hosteleria.id, sanidad.id, quimica.id].sort(),
		);
		expect(
			await ids(
				"educationalCategory=formacion-profesional&knowledgeAreas=ingles&professionalFamilies=hosteleria-y-turismo",
			),
		).toEqual([hosteleria.id]);
		expect(
			await ids("professionalFamilies=hosteleria-y-turismo,sanidad"),
		).toEqual([hosteleria.id, sanidad.id].sort());

		const detail = await (
			await anonymous.request(`/api/v1/resources/${hosteleria.slug}`)
		).json();
		expect(
			detail.knowledgeAreas.map((a: { label: string }) => a.label),
		).toEqual(["Inglés"]);
		expect(detail.professionalFamilies).toEqual([
			{ id: "hosteleria-y-turismo", label: "Hostelería y Turismo" },
		]);
	});
});
