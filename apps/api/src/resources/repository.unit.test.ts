import { expect, test, describe } from "bun:test";
import { getDb } from "../db.ts";
import * as repo from "@procomun/db/repository";

const db = () => getDb().db;
const listResources = (opts: Parameters<typeof repo.listResources>[1]) => repo.listResources(db(), opts);
const getResourceById = (id: string) => repo.getResourceById(db(), id);
const getResourceBySlug = (slug: string) => repo.getResourceBySlug(db(), slug);
const createResource = (data: Parameters<typeof repo.createResource>[1]) => repo.createResource(db(), data);
const updateResource = (id: string, data: Parameters<typeof repo.updateResource>[2]) => repo.updateResource(db(), id, data);
const deleteResource = (id: string) => repo.deleteResource(db(), id);
const updateEditorialStatus = (id: string, status: string, curatorId: string) => repo.updateEditorialStatus(db(), id, status, curatorId);

const baseResource = {
	title: "Recurso test repo",
	description: "Descripción completa del recurso para testing",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
};

describe("Repository — CRUD completo", () => {
	let createdId: string;
	let createdSlug: string;

	test("createResource → devuelve id y slug", async () => {
		const result = await createResource(baseResource);
		expect(result.id).toBeDefined();
		expect(result.slug).toContain("recurso-test-repo");
		createdId = result.id;
		createdSlug = result.slug;
	});

	test("createResource con subjects y levels", async () => {
		const result = await createResource({
			...baseResource,
			title: "Recurso con materias",
			subjects: ["matematicas", "informatica"],
			levels: ["educacion-primaria"],
		});
		expect(result.id).toBeDefined();

		const resource = await getResourceById(result.id);
		expect(resource).not.toBeNull();
		expect(resource!.subjects).toContain("matematicas");
		expect(resource!.subjects).toContain("informatica");
		expect(resource!.levels).toContain("educacion-primaria");
	});

	test("getResourceById → recurso existente", async () => {
		const resource = await getResourceById(createdId);
		expect(resource).not.toBeNull();
		expect(resource!.title).toBe(baseResource.title);
		expect(resource!.subjects).toEqual([]);
		expect(resource!.levels).toEqual([]);
	});

	test("getResourceById → null para id inexistente", async () => {
		const resource = await getResourceById("no-existe");
		expect(resource).toBeNull();
	});

	test("getResourceBySlug → recurso existente", async () => {
		const resource = await getResourceBySlug(createdSlug);
		expect(resource).not.toBeNull();
		expect(resource!.id).toBe(createdId);
		expect(resource!.subjects).toEqual([]);
		expect(resource!.mediaItems).toEqual([]);
	});

	test("getResourceBySlug → incluye media items asociados", async () => {
		await repo.createMediaItem(getDb().db, {
			resourceId: createdId,
			type: "file",
			mimeType: "application/pdf",
			url: "/api/admin/uploads/upload-public/content",
			fileSize: 1024,
			filename: "guia.pdf",
		});

		const resource = await getResourceBySlug(createdSlug);
		expect(resource).not.toBeNull();
		expect(resource!.mediaItems).toHaveLength(1);
		expect(resource!.mediaItems?.[0]?.filename).toBe("guia.pdf");
		expect(resource!.mediaItems?.[0]?.url).toBe("/api/v1/uploads/upload-public/content");
	});

	test("getResourceBySlug → null para slug inexistente", async () => {
		const resource = await getResourceBySlug("slug-que-no-existe");
		expect(resource).toBeNull();
	});

	test("listResources → lista con resultados", async () => {
		const result = await listResources({});
		expect(result.data.length).toBeGreaterThan(0);
		expect(typeof result.total).toBe("number");
	});

	test("listResources con búsqueda", async () => {
		const result = await listResources({ search: "test repo" });
		expect(result.data.length).toBeGreaterThan(0);
	});

	test("listResources con status", async () => {
		const result = await listResources({ status: "draft" });
		expect(Array.isArray(result.data)).toBe(true);
	});

	test("listResources filtra por resourceType", async () => {
		const video = await createResource({
			...baseResource,
			title: "Recurso video repo",
			resourceType: "video",
		});

		const result = await listResources({ resourceType: "video" });
		const ids = result.data.map((resource) => resource.id);
		expect(ids).toContain(video.id);
		expect(ids).not.toContain(createdId);
	});

	test("listResources filtra por language", async () => {
		const english = await createResource({
			...baseResource,
			title: "English repo resource",
			language: "en",
		});

		const result = await listResources({ language: "en" });
		const ids = result.data.map((resource) => resource.id);
		expect(ids).toContain(english.id);
		expect(ids).not.toContain(createdId);
	});

	test("listResources filtra por license", async () => {
		const open = await createResource({
			...baseResource,
			title: "CC0 repo resource",
			license: "cc0",
		});

		const result = await listResources({ license: "cc0" });
		const ids = result.data.map((resource) => resource.id);
		expect(ids).toContain(open.id);
		expect(ids).not.toContain(createdId);
	});

	test("listResources combina busqueda y filtros", async () => {
		const result = await listResources({
			search: "English",
			language: "en",
		});

		expect(result.data.some((resource) => resource.title === "English repo resource")).toBe(true);
		expect(result.data.every((resource) => resource.language === "en")).toBe(true);
	});

	test("listResources filtra por visibleToUserId para propietarios o curadores asignados", async () => {
		const authorId = `author-${crypto.randomUUID()}`;
		const curatorId = `curator-${crypto.randomUUID()}`;

		await repo.ensureUser(db(), {
			id: authorId,
			email: `${authorId}@local.invalid`,
			name: "Author Review Queue",
			role: "author",
		});
		await repo.ensureUser(db(), {
			id: curatorId,
			email: `${curatorId}@local.invalid`,
			name: "Curator Review Queue",
			role: "curator",
		});

		const resource = await createResource({
			...baseResource,
			title: `Assigned curator ${crypto.randomUUID()}`,
			createdBy: authorId,
		});

		await updateEditorialStatus(resource.id, "review", curatorId);

		const result = await listResources({
			status: "review",
			visibleToUserId: curatorId,
		});

		expect(result.data.some((item) => item.id === resource.id)).toBe(true);
	});

	test("updateResource → actualiza campos", async () => {
		await updateResource(createdId, { title: "Título actualizado repo" });
		const resource = await getResourceById(createdId);
		expect(resource!.title).toBe("Título actualizado repo");
	});

	test("updateEditorialStatus → cambia estado", async () => {
		await updateEditorialStatus(createdId, "published", "1");
		const resource = await getResourceById(createdId);
		expect(resource!.editorialStatus).toBe("published");
	});

	test("deleteResource → soft delete", async () => {
		await deleteResource(createdId);
		const resource = await getResourceById(createdId);
		expect(resource).toBeNull();
	});

	test("listResources.total es siempre un número", async () => {
		const result = await listResources({});
		expect(typeof result.total).toBe("number");
		expect(Number.isFinite(result.total)).toBe(true);
		expect(result.total).toBeGreaterThan(0);
	});

	test("listResources.total con filtro de status es un número", async () => {
		const result = await listResources({ status: "published" });
		expect(typeof result.total).toBe("number");
		expect(Number.isFinite(result.total)).toBe(true);
	});
});

describe("listResources — búsqueda por nombre de autor (DEF-014)", () => {
	test("encuentra recursos por nombre o apellido del creador aunque el título y el campo author no lo contengan", async () => {
		await repo.ensureUser(db(), {
			id: "u-humberto",
			email: "humberto@test.com",
			name: "Humberto Expósito",
			role: "author",
		});
		const created = await createResource({
			...baseResource,
			title: `Material didactico ${crypto.randomUUID()}`,
			description: "Contenido sin el nombre del creador",
			author: null,
			createdBy: "u-humberto",
		});

		// Por nombre
		const byName = await listResources({ search: "Humberto" });
		expect(byName.data.some((r) => r.id === created.id)).toBe(true);
		expect(byName.total).toBeGreaterThan(0);

		// Por apellido (con acento → normalizado)
		const bySurname = await listResources({ search: "Expósito" });
		expect(bySurname.data.some((r) => r.id === created.id)).toBe(true);

		// El conteo no debe romper (la query de conteo también debe unir la tabla user).
		expect(bySurname.total).toBeGreaterThan(0);
	});
});
