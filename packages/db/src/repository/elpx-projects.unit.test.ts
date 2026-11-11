import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	createElpxProject,
	listElpxProjectsByResourceIds,
	listElpxProjectsForScreenshotScan,
	setElpxProjectHasScreenshot,
} from "./elpx-projects.ts";
import { createResource } from "./resources.ts";
import type { DrizzleDB } from "./shared.ts";
import { ensureUser } from "./users.ts";

// #409: la miniatura screenshot.png se detecta una vez y se guarda en el proyecto.
describe("elpx_projects.has_screenshot", () => {
	let db: DrizzleDB;
	let pglite: PGlite;
	let resourceId: string;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureUser(db, { id: "u1", email: "a@b.com", name: "A" });
		const res = await createResource(db, {
			title: "Recurso",
			description: "Desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: "u1",
		});
		resourceId = res.id;
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("los listados devuelven hasScreenshot del proyecto", async () => {
		await createElpxProject(db, {
			resourceId,
			hash: "con-captura",
			extractPath: "/tmp/con-captura",
			originalFilename: "a.elpx",
			hasPreview: true,
			hasScreenshot: true,
		});

		const rows = await listElpxProjectsByResourceIds(db, [resourceId]);

		expect(rows).toEqual([
			{
				resourceId,
				hash: "con-captura",
				hasPreview: true,
				hasScreenshot: true,
			},
		]);
	});

	test("sin indicarlo, el proyecto no tiene captura", async () => {
		await createElpxProject(db, {
			resourceId,
			hash: "sin-captura",
			extractPath: "/tmp/sin-captura",
			originalFilename: "a.elpx",
			hasPreview: true,
		});

		const [row] = await listElpxProjectsByResourceIds(db, [resourceId]);

		expect(row?.hasScreenshot).toBe(false);
	});

	test("el relleno lista los proyectos y marca la captura", async () => {
		const { id } = await createElpxProject(db, {
			resourceId,
			hash: "previo",
			extractPath: "/tmp/previo",
			originalFilename: "a.elpx",
			hasPreview: true,
		});

		expect(await listElpxProjectsForScreenshotScan(db)).toEqual([
			{ id, hash: "previo", extractPath: "/tmp/previo", hasScreenshot: false },
		]);

		await setElpxProjectHasScreenshot(db, id, true);

		const [row] = await listElpxProjectsByResourceIds(db, [resourceId]);
		expect(row?.hasScreenshot).toBe(true);
	});
});
