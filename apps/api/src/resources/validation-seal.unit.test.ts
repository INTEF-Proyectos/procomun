import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { onPublicContentChanged } from "./validation-seal.ts";

// Issue #420: punto único por el que pasan las rutas que cambian el contenido
// o los metadatos públicos de un recurso.

async function validatedResource() {
	const db = getDb().db;
	const curatorId = `curator-${crypto.randomUUID()}`;
	await repo.ensureUser(db, {
		id: curatorId,
		email: `${curatorId}@local.invalid`,
		role: "curator",
	});
	const { id } = await repo.createResource(db, {
		title: "Recurso validado",
		description: "Descripción",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
	});
	await repo.updateEditorialStatus(db, id, "published", curatorId, {
		validationSeal: "grant",
	});
	return id;
}

async function validatedAt(id: string) {
	const resource = (await repo.getResourceById(getDb().db, id)) as {
		validatedAt: Date | null;
	} | null;
	return resource?.validatedAt ?? null;
}

describe("onPublicContentChanged", () => {
	for (const role of ["author", "editor", undefined]) {
		test(`quita el sello si cambia el contenido un ${role ?? "usuario sin rol"}`, async () => {
			const id = await validatedResource();

			expect(await onPublicContentChanged(getDb().db, id, { role })).toBe(true);
			expect(await validatedAt(id)).toBeNull();
		});
	}

	for (const role of ["curator", "admin"]) {
		test(`lo conserva si cambia el contenido un ${role}`, async () => {
			const id = await validatedResource();

			expect(await onPublicContentChanged(getDb().db, id, { role })).toBe(
				false,
			);
			expect(await validatedAt(id)).toBeInstanceOf(Date);
		});
	}

	test("no hace nada en un recurso sin sello", async () => {
		const { id } = await repo.createResource(getDb().db, {
			title: "Sin sello",
			description: "Descripción",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});

		expect(
			await onPublicContentChanged(getDb().db, id, { role: "author" }),
		).toBe(false);
	});
});
