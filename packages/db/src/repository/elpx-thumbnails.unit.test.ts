import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	createElpxProject,
	listElpxProjectsByResourceIds,
} from "./elpx-projects.ts";
import {
	claimThumbnailJobs,
	completeThumbnailJob,
	countThumbnailStatuses,
	enqueueThumbnailJobs,
	failThumbnailJob,
	getThumbnailFileVisibility,
	initialThumbnailStatus,
	listThumbnailBackfillCandidates,
	MAX_THUMBNAIL_ERROR_LENGTH,
	markThumbnailEmpty,
	recoverStaleThumbnailJobs,
	releaseThumbnailJob,
} from "./elpx-thumbnails.ts";
import { createResource } from "./resources.ts";
import type { DrizzleDB } from "./shared.ts";
import { ensureUser } from "./users.ts";

const { elpxProjects, resources, resourceVersions } = schema;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const FILE = `${"a".repeat(64)}.jpg`;

let pglite: PGlite;
let db: DrizzleDB;

beforeAll(async () => {
	pglite = new PGlite();
	await createTables(pglite);
	db = drizzle(pglite, { schema });
	await ensureUser(db, { id: "u1", email: "a@b.com", name: "A" });
}, 60_000);

afterAll(async () => {
	await pglite.close();
});

beforeEach(async () => {
	await db.delete(resourceVersions);
	await db.delete(elpxProjects);
	await db.delete(resources);
});

async function newResource(title = "Recurso") {
	const res = await createResource(db, {
		title,
		description: "Desc",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: "u1",
	});
	return res.id;
}

async function newProject(
	hash: string,
	options: {
		resourceId?: string;
		hasPreview?: boolean;
		hasScreenshot?: boolean;
		createdAt?: Date;
	} = {},
) {
	const resourceId = options.resourceId ?? (await newResource(hash));
	const { id } = await createElpxProject(db, {
		resourceId,
		hash,
		extractPath: `/tmp/${hash}`,
		originalFilename: `${hash}.elpx`,
		hasPreview: options.hasPreview ?? true,
		hasScreenshot: options.hasScreenshot ?? false,
	});
	if (options.createdAt) {
		await db
			.update(elpxProjects)
			.set({ createdAt: options.createdAt })
			.where(eq(elpxProjects.id, id));
	}
	return { id, resourceId };
}

async function row(id: string) {
	const rows = await db
		.select()
		.from(elpxProjects)
		.where(eq(elpxProjects.id, id));
	return rows[0];
}

describe("initialThumbnailStatus (#470)", () => {
	test("solo queda pendiente un paquete con portada y sin imagen propia", () => {
		expect(initialThumbnailStatus({ hasPreview: true })).toBe("pending");
		expect(
			initialThumbnailStatus({ hasPreview: true, hasScreenshot: true }),
		).toBe("skipped");
		expect(initialThumbnailStatus({ hasPreview: false })).toBe("skipped");
		expect(
			initialThumbnailStatus({ hasPreview: true, hasPreviewImage: true }),
		).toBe("skipped");
	});

	test("createElpxProject guarda el estado inicial y admite uno explícito", async () => {
		const pending = await newProject("sin-captura");
		const withShot = await newProject("con-captura", { hasScreenshot: true });
		const noIndex = await newProject("sin-index", { hasPreview: false });
		const forced = await createElpxProject(db, {
			resourceId: await newResource("forzado"),
			hash: "forzado",
			extractPath: "/tmp/forzado",
			originalFilename: "f.elpx",
			hasPreview: true,
			thumbnailStatus: "skipped",
		});

		expect((await row(pending.id))?.thumbnailStatus).toBe("pending");
		expect((await row(withShot.id))?.thumbnailStatus).toBe("skipped");
		expect((await row(noIndex.id))?.thumbnailStatus).toBe("skipped");
		expect((await row(forced.id))?.thumbnailStatus).toBe("skipped");
		expect((await row(pending.id))?.thumbnailAttempts).toBe(0);
	});
});

describe("cola de miniaturas en elpx_projects (#470)", () => {
	test("reclama los pendientes por antigüedad, con límite y una sola vez", async () => {
		const older = await newProject("viejo", { createdAt: at(-60) });
		const newer = await newProject("nuevo", { createdAt: at(-30) });
		await newProject("con-captura", { hasScreenshot: true });

		const first = await claimThumbnailJobs(db, { limit: 1, now: T0 });
		expect(first).toEqual([{ id: older.id, hash: "viejo", attempts: 0 }]);
		expect((await row(older.id))?.thumbnailStatus).toBe("processing");
		expect((await row(older.id))?.thumbnailUpdatedAt).toEqual(T0);

		const second = await claimThumbnailJobs(db, { limit: 5, now: T0 });
		expect(second.map((job) => job.id)).toEqual([newer.id]);
		expect(await claimThumbnailJobs(db, { limit: 5, now: T0 })).toEqual([]);
		expect(await claimThumbnailJobs(db, { limit: 0, now: T0 })).toEqual([]);
	});

	test("no reclama un reintento antes de su hora", async () => {
		const { id } = await newProject("reintento");
		const [job] = await claimThumbnailJobs(db, { limit: 1, now: T0 });
		if (!job) throw new Error("sin trabajo");
		await failThumbnailJob(db, job, {
			error: "timeout",
			retryable: true,
			maxAttempts: 3,
			retryAt: at(60),
			now: T0,
		});

		expect(await claimThumbnailJobs(db, { limit: 1, now: at(30) })).toEqual([]);
		const later = await claimThumbnailJobs(db, { limit: 1, now: at(61) });
		expect(later).toEqual([{ id, hash: "reintento", attempts: 1 }]);
	});

	test("una captura guardada deja done, el fichero y lo devuelve en los listados", async () => {
		const { id, resourceId } = await newProject("hecho");
		await claimThumbnailJobs(db, { limit: 1, now: T0 });

		expect(await completeThumbnailJob(db, id, { file: FILE, now: at(5) })).toBe(
			true,
		);

		const saved = await row(id);
		expect(saved?.thumbnailStatus).toBe("done");
		expect(saved?.thumbnailFile).toBe(FILE);
		expect(saved?.thumbnailAttempts).toBe(1);
		expect(saved?.thumbnailError).toBeNull();
		const [listed] = await listElpxProjectsByResourceIds(db, [resourceId]);
		expect(listed?.thumbnailFile).toBe(FILE);
		// Sin estar en processing no se toca (p. ej. tras un --force).
		expect(await completeThumbnailJob(db, id, { file: FILE })).toBe(false);
	});

	test("una portada vacía queda en empty sin fichero", async () => {
		const { id } = await newProject("vacio");
		await claimThumbnailJobs(db, { limit: 1, now: T0 });

		expect(await markThumbnailEmpty(db, id, { now: at(5) })).toBe(true);

		const saved = await row(id);
		expect(saved?.thumbnailStatus).toBe("empty");
		expect(saved?.thumbnailFile).toBeNull();
		expect(saved?.thumbnailAttempts).toBe(1);
	});

	test("reintenta los fallos pasajeros hasta el máximo y luego queda failed", async () => {
		const { id } = await newProject("fallo");
		const options = {
			error: "timeout",
			retryable: true,
			maxAttempts: 2,
			retryAt: T0,
			now: T0,
		};

		const [first] = await claimThumbnailJobs(db, { limit: 1, now: T0 });
		if (!first) throw new Error("sin trabajo");
		expect(await failThumbnailJob(db, first, options)).toBe("pending");
		expect((await row(id))?.thumbnailNextAttemptAt).toEqual(T0);

		const [second] = await claimThumbnailJobs(db, { limit: 1, now: T0 });
		if (!second) throw new Error("sin trabajo");
		expect(second.attempts).toBe(1);
		expect(await failThumbnailJob(db, second, options)).toBe("failed");

		const saved = await row(id);
		expect(saved?.thumbnailStatus).toBe("failed");
		expect(saved?.thumbnailAttempts).toBe(2);
		expect(saved?.thumbnailError).toBe("timeout");
		expect(saved?.thumbnailNextAttemptAt).toBeNull();
	});

	test("un fallo permanente no se reintenta y el motivo se recorta", async () => {
		const { id } = await newProject("permanente");
		const [job] = await claimThumbnailJobs(db, { limit: 1, now: T0 });
		if (!job) throw new Error("sin trabajo");

		const status = await failThumbnailJob(db, job, {
			error: "x".repeat(MAX_THUMBNAIL_ERROR_LENGTH * 2),
			retryable: false,
			maxAttempts: 3,
			retryAt: T0,
		});

		expect(status).toBe("failed");
		expect((await row(id))?.thumbnailError).toHaveLength(
			MAX_THUMBNAIL_ERROR_LENGTH,
		);
	});

	test("devolver un trabajo a la cola no gasta intentos", async () => {
		const { id } = await newProject("servicio-caido");
		await claimThumbnailJobs(db, { limit: 1, now: T0 });

		await releaseThumbnailJob(db, id, {
			retryAt: at(60),
			error: "servicio no disponible",
			now: T0,
		});

		const saved = await row(id);
		expect(saved?.thumbnailStatus).toBe("pending");
		expect(saved?.thumbnailAttempts).toBe(0);
		expect(saved?.thumbnailNextAttemptAt).toEqual(at(60));
		expect(saved?.thumbnailError).toBe("servicio no disponible");
	});

	test("recupera los processing colgados y agota los que tumban el servicio", async () => {
		// created_at explícito y anterior a todo: con el fichero completo, el
		// primer reclamo se llevaba proyectos pendientes de tests anteriores,
		// creados antes que estos, y «colgado» no llegaba a reclamarse en T0.
		const stuck = await newProject("colgado", { createdAt: at(-30) });
		const poison = await newProject("veneno", { createdAt: at(-20) });
		const fresh = await newProject("reciente", { createdAt: at(-10) });
		await claimThumbnailJobs(db, { limit: 2, now: T0 });
		await db
			.update(elpxProjects)
			.set({ thumbnailAttempts: 2 })
			.where(eq(elpxProjects.id, poison.id));
		await claimThumbnailJobs(db, { limit: 1, now: at(100) });

		const result = await recoverStaleThumbnailJobs(db, {
			staleBefore: at(50),
			maxAttempts: 3,
			now: at(120),
		});

		expect(result).toEqual({ requeued: 1, failed: 1 });
		expect((await row(stuck.id))?.thumbnailStatus).toBe("pending");
		expect((await row(stuck.id))?.thumbnailAttempts).toBe(1);
		expect((await row(poison.id))?.thumbnailStatus).toBe("failed");
		expect((await row(poison.id))?.thumbnailAttempts).toBe(3);
		expect((await row(fresh.id))?.thumbnailStatus).toBe("processing");
	});
});

describe("relleno de miniaturas (#470)", () => {
	test("elige el proyecto que enseña la tarjeta y solo si no tiene imagen", async () => {
		const plain = await newProject("sin-imagen");
		await newProject("con-captura", { hasScreenshot: true });
		await newProject("sin-portada", { hasPreview: false });
		const legacy = await newProject("con-preview");
		await db
			.update(resources)
			.set({ thumbnailUrl: `/api/v1/thumbnails/${FILE}` })
			.where(eq(resources.id, legacy.resourceId));
		const blank = await newProject("preview-vacia");
		await db
			.update(resources)
			.set({ thumbnailUrl: "  " })
			.where(eq(resources.id, blank.resourceId));
		const deleted = await newProject("borrado");
		await db
			.update(resources)
			.set({ deletedAt: new Date() })
			.where(eq(resources.id, deleted.resourceId));

		// Recurso versionado: cuenta la versión vigente, no la última subida.
		const versioned = await newProject("vigente", { createdAt: at(-100) });
		await newProject("copia-de-trabajo", {
			resourceId: versioned.resourceId,
			createdAt: at(-10),
		});
		await db.insert(resourceVersions).values({
			id: "v1",
			resourceId: versioned.resourceId,
			versionNumber: 1,
			elpxProjectId: versioned.id,
			fileSha256: "f".repeat(64),
			metadataSnapshot: {},
		});
		await db
			.update(resources)
			.set({ currentVersionId: "v1" })
			.where(eq(resources.id, versioned.resourceId));

		const candidates = await listThumbnailBackfillCandidates(db);

		expect(candidates.map((candidate) => candidate.hash).sort()).toEqual([
			"preview-vacia",
			"sin-imagen",
			"vigente",
		]);
		expect(candidates.find((c) => c.id === plain.id)?.status).toBe("pending");
	});

	test("encolar reinicia los intentos y no toca los que ya están en cola", async () => {
		const failed = await newProject("fallido");
		const running = await newProject("en-curso");
		await claimThumbnailJobs(db, { limit: 2, now: T0 });
		const [job] = await claimThumbnailJobs(db, { limit: 1, now: T0 });
		expect(job).toBeUndefined();
		await failThumbnailJob(
			db,
			{ id: failed.id, attempts: 2 },
			{ error: "x", retryable: false, maxAttempts: 3, retryAt: T0 },
		);

		const queued = await enqueueThumbnailJobs(db, [failed.id, running.id], {
			now: at(10),
		});

		expect(queued).toBe(1);
		const saved = await row(failed.id);
		expect(saved?.thumbnailStatus).toBe("pending");
		expect(saved?.thumbnailAttempts).toBe(0);
		expect(saved?.thumbnailError).toBeNull();
		expect((await row(running.id))?.thumbnailStatus).toBe("processing");
		expect(await enqueueThumbnailJobs(db, [])).toBe(0);
	});

	test("cuenta los proyectos por estado", async () => {
		await newProject("a");
		await newProject("b");
		await newProject("c", { hasScreenshot: true });
		const legacy = await newProject("d");
		await db
			.update(elpxProjects)
			.set({ thumbnailStatus: null })
			.where(eq(elpxProjects.id, legacy.id));

		expect(await countThumbnailStatuses(db)).toEqual({
			pending: 2,
			skipped: 1,
			sin_estado: 1,
		});
	});
});

// Revisión de #481 (adenda 2026-11-03 de ADR-0046): la URL estable de una
// miniatura solo se sirve si el fichero pertenece a un recurso publicado.
describe("visibilidad de un fichero del almacén de miniaturas", () => {
	const OTHER = `${"b".repeat(64)}.jpg`;
	const legacyUrl = (file: string) => `/api/v1/thumbnails/${file}`;
	const visibility = (file: string) =>
		getThumbnailFileVisibility(db, file, legacyUrl(file));

	async function setStatus(resourceId: string, editorialStatus: string) {
		await db
			.update(resources)
			.set({ editorialStatus })
			.where(eq(resources.id, resourceId));
	}

	async function generated(hash: string, file: string, status: string) {
		const project = await newProject(hash);
		await db
			.update(elpxProjects)
			.set({ thumbnailStatus: "done", thumbnailFile: file })
			.where(eq(elpxProjects.id, project.id));
		await setStatus(project.resourceId, status);
		return project;
	}

	test("un fichero sin ningún recurso no es visible", async () => {
		expect(await visibility(FILE)).toBeNull();
	});

	test("miniatura generada: pública solo si el recurso está publicado", async () => {
		const project = await generated("generada", FILE, "draft");
		expect(await visibility(FILE)).toBe("private");
		for (const status of ["review", "archived"]) {
			await setStatus(project.resourceId, status);
			expect(await visibility(FILE)).toBe("private");
		}
		await setStatus(project.resourceId, "published");
		expect(await visibility(FILE)).toBe("public");
		// Despublicar cierra el acceso en la consulta siguiente.
		await setStatus(project.resourceId, "archived");
		expect(await visibility(FILE)).toBe("private");
	});

	test("preview legacy: mismas reglas por resources.thumbnail_url", async () => {
		const id = await newResource("legacy");
		await db
			.update(resources)
			.set({ thumbnailUrl: legacyUrl(OTHER) })
			.where(eq(resources.id, id));
		expect(await visibility(OTHER)).toBe("private");
		await setStatus(id, "published");
		expect(await visibility(OTHER)).toBe("public");
		expect(await visibility(FILE)).toBeNull();
	});

	test("un fichero compartido con un recurso publicado es público", async () => {
		await generated("borrador", FILE, "draft");
		const id = await newResource("publicado");
		await db
			.update(resources)
			.set({ thumbnailUrl: legacyUrl(FILE), editorialStatus: "published" })
			.where(eq(resources.id, id));
		expect(await visibility(FILE)).toBe("public");
	});

	test("un recurso borrado no hace visible su miniatura", async () => {
		const project = await generated("borrado", FILE, "published");
		await db
			.update(resources)
			.set({ deletedAt: new Date() })
			.where(eq(resources.id, project.resourceId));
		expect(await visibility(FILE)).toBeNull();
	});

	test("de un recurso publicado con versiones, solo la miniatura del proyecto vigente es pública", async () => {
		const current = await generated("vigente", FILE, "published");
		const draft = await newProject("copia-nueva", {
			resourceId: current.resourceId,
		});
		await db
			.update(elpxProjects)
			.set({ thumbnailStatus: "done", thumbnailFile: OTHER })
			.where(eq(elpxProjects.id, draft.id));
		// Sin versión vigente cuentan todos sus proyectos, como en
		// isElpxHashHistorical (#323).
		expect(await visibility(OTHER)).toBe("public");

		await db.insert(resourceVersions).values({
			id: "v-481",
			resourceId: current.resourceId,
			versionNumber: 1,
			elpxProjectId: current.id,
			fileSha256: "e".repeat(64),
			metadataSnapshot: {},
		});
		await db
			.update(resources)
			.set({ currentVersionId: "v-481" })
			.where(eq(resources.id, current.resourceId));

		expect(await visibility(FILE)).toBe("public");
		// La copia de trabajo nueva no se ve hasta que se publique.
		expect(await visibility(OTHER)).toBe("private");
	});
});
