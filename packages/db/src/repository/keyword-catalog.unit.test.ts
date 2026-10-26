import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { DrizzleDB } from "../repository/shared.ts";
import {
	createResource,
	ensureUser,
	getResourceById,
	listResources,
	updateResource,
} from "../repository.ts";
import * as schema from "../schema/index.ts";
import { resources } from "../schema/resources.ts";
import { tagAliases, tags } from "../schema/tags.ts";
import { createTables } from "../setup.ts";
import { KEYWORD_MESSAGES } from "../tags/keyword-catalog.ts";
import {
	createCatalogKeyword,
	listResourceCatalogKeywords,
	searchCatalogKeywords,
	setResourceCatalogKeywords,
} from "./keyword-catalog.ts";
import {
	ensureTag,
	listResourceTags,
	mergeTags,
	migrateKeywordsToTags,
	TagMergeError,
} from "./tags.ts";

describe("repositorio del catálogo de palabras clave (#384)", () => {
	let client: PGlite;
	let db: DrizzleDB;
	let userId: string;

	async function newResource(extra: Record<string, unknown> = {}) {
		return createResource(db, {
			title: `Recurso ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
			...extra,
		});
	}

	beforeEach(async () => {
		client = new PGlite();
		await createTables(client);
		db = drizzle(client, { schema }) as unknown as DrizzleDB;
		userId = crypto.randomUUID();
		await ensureUser(db, {
			id: userId,
			email: `${userId}@keywords.test`,
			name: "Curator",
			role: "curator",
		});
	});

	afterEach(async () => {
		await client.close();
	});

	test("el esquema siembra los 50 términos y sus alias una sola vez", async () => {
		const catalog = await db
			.select({ id: tags.id })
			.from(tags)
			.where(eq(tags.catalog, true));
		expect(catalog).toHaveLength(50);

		const fractions = await searchCatalogKeywords(db, "fracciones");
		expect(fractions.map((item) => item.label)).toEqual([
			"Cálculo y resolución de problemas",
		]);
		const abp = await searchCatalogKeywords(db, "ABP");
		expect(abp.map((item) => item.label).sort()).toEqual([
			"Aprendizaje basado en problemas",
			"Aprendizaje basado en proyectos",
		]);

		// Un término o alias borrado no vuelve al arrancar otra vez.
		await db.delete(tagAliases).where(eq(tagAliases.normalized, "dua"));
		await db.delete(tags).where(eq(tags.id, "robotica"));
		await createTables(client);
		expect(await searchCatalogKeywords(db, "DUA")).toEqual([]);
		expect(await searchCatalogKeywords(db, "robotica")).toEqual([]);
	});

	test("el alta registra autor, rechaza duplicados y no toca etiquetas libres", async () => {
		const free = await ensureTag(db, "Pensamiento visual");
		const created = await createCatalogKeyword(db, {
			label: "  Pensamiento   visual ",
			aliases: ["visual thinking", "pensamiento visual"],
			createdBy: userId,
		});
		expect(created.status).toBe("created");
		if (created.status !== "created") return;
		expect(created.keyword.label).toBe("Pensamiento visual");
		expect(created.keyword.slug).toBe("pensamiento-visual-1");

		const stored = await db
			.select()
			.from(tags)
			.where(eq(tags.id, created.keyword.id));
		expect(stored[0]?.createdBy).toBe(userId);
		expect(stored[0]?.createdAt).toBeInstanceOf(Date);
		const unchanged = await db.select().from(tags).where(eq(tags.id, free.id));
		expect(unchanged[0]?.slug).toBe("pensamiento-visual");
		expect(unchanged[0]?.catalog).toBe(false);

		const byAlias = await searchCatalogKeywords(db, "visual thinking");
		expect(byAlias[0]?.id).toBe(created.keyword.id);

		const duplicate = await createCatalogKeyword(db, {
			label: "#pensamiento VISUAL",
			createdBy: userId,
		});
		expect(duplicate).toEqual({
			status: "duplicate",
			keyword: created.keyword,
		});
		expect(
			(await createCatalogKeyword(db, { label: "   ", createdBy: userId }))
				.status,
		).toBe("invalid");
	});

	test("dos altas simultáneas de la misma denominación crean un solo término", async () => {
		const results = await Promise.all([
			createCatalogKeyword(db, { label: "Oratoria", createdBy: userId }),
			createCatalogKeyword(db, { label: "oratoria", createdBy: userId }),
		]);
		expect(results.map((result) => result.status).sort()).toEqual([
			"created",
			"duplicate",
		]);
		const rows = await db
			.select({ id: tags.id })
			.from(tags)
			.where(sql`${tags.catalog} and lower(${tags.label}) = 'oratoria'`);
		expect(rows).toHaveLength(1);
	});

	test("el servidor valida máximo, duplicados y pertenencia al catálogo", async () => {
		const { id } = await newResource();
		const six = [
			"historia",
			"geografia",
			"musica",
			"fisica",
			"quimica",
			"biologia",
		];
		await expect(setResourceCatalogKeywords(db, id, six)).rejects.toMatchObject(
			{
				message: KEYWORD_MESSAGES.max,
				status: 400,
			},
		);
		await expect(
			setResourceCatalogKeywords(db, id, ["historia", "historia"]),
		).rejects.toMatchObject({ status: 400 });
		const free = await ensureTag(db, "Scratch");
		await expect(
			setResourceCatalogKeywords(db, id, [free.id]),
		).rejects.toMatchObject({ status: 400 });

		await setResourceCatalogKeywords(db, id, ["historia", "geometria"]);
		await setResourceCatalogKeywords(db, id, ["geometria"]);
		expect(await listResourceCatalogKeywords(db, id)).toEqual([
			{ id: "geometria", slug: "geometria", label: "Geometría" },
		]);
		const historia = await db
			.select()
			.from(tags)
			.where(eq(tags.id, "historia"));
		expect(historia[0]?.usageCount).toBe(0);
	});

	test("un alta con keywordIds inválidos no crea el recurso", async () => {
		const before = await db.select({ id: resources.id }).from(resources);
		await expect(
			newResource({ keywordIds: ["no-existe"] }),
		).rejects.toMatchObject({ status: 400 });
		const after = await db.select({ id: resources.id }).from(resources);
		expect(after).toHaveLength(before.length);

		const { id } = await newResource({ keywordIds: ["geometria"] });
		expect((await getResourceById(db, id))?.catalogKeywords).toEqual([
			{ id: "geometria", slug: "geometria", label: "Geometría" },
		]);
		await updateResource(db, id, { keywordIds: ["historia", "biologia"] });
		expect(
			(await listResourceCatalogKeywords(db, id)).map((item) => item.id),
		).toEqual(["biologia", "historia"]);
	});

	test("escribir keywords por la vía antigua no borra ni asigna términos del catálogo", async () => {
		const { id } = await newResource({
			keywords:
				"Historia, Geografía, Música, Física, Química, Biología, Robótica",
			keywordIds: ["geometria"],
		});
		expect(
			(await listResourceCatalogKeywords(db, id)).map((item) => item.id),
		).toEqual(["geometria"]);

		await updateResource(db, id, { keywords: "Historia, Scratch" });
		await migrateKeywordsToTags(db);
		const linked = await listResourceTags(db, id);
		expect(linked.map((tag) => [tag.label, tag.catalog])).toEqual([
			["Geometría", true],
			["Scratch", false],
		]);
		const resource = await getResourceById(db, id);
		expect(resource?.keywords).toBe("Historia, Scratch");

		const listed = await listResources(db, { search: resource?.title });
		expect(listed.data[0]?.catalogLabels).toBe("Geometría");
	});

	test("no se fusiona una etiqueta libre con un término del catálogo", async () => {
		const free = await ensureTag(db, "Mates");
		await expect(mergeTags(db, free.id, "matematicas")).rejects.toBeInstanceOf(
			TagMergeError,
		);
	});
});
