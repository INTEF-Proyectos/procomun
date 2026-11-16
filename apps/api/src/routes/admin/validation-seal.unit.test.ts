import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { resources } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import { apiResourceRoutes } from "../api-resources.ts";
import { publicRoutes } from "../public.ts";
import { uploadRoutes } from "../uploads.ts";
import { adminRoutes } from "./index.ts";

// Sello «Validado» (issue #420, ADR-0049 y su adenda 2026-11-16): lo pone
// «Aprobar y publicar» (review → published) de un curator o un admin, no la
// publicación directa de un editor; lo conservan las ediciones de un curator
// o un admin y lo quitan las del autor.

const ELPX_FIXTURE = path.resolve(
	import.meta.dir,
	"../../test-fixtures/elpx/really-simple-test-project.elpx",
);

let storageDir: string;
let previousStorageDir: string | undefined;

beforeAll(async () => {
	previousStorageDir = process.env.UPLOAD_STORAGE_DIR;
	storageDir = await mkdtemp(path.join(tmpdir(), "procomun-validation-seal-"));
	process.env.UPLOAD_STORAGE_DIR = storageDir;
});

afterAll(async () => {
	if (previousStorageDir === undefined) delete process.env.UPLOAD_STORAGE_DIR;
	else process.env.UPLOAD_STORAGE_DIR = previousStorageDir;
	await rm(storageDir, { recursive: true, force: true });
});

const completeResource = {
	title: "Recurso para el sello",
	description: "Descripción completa para poder cambiar de estado",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	author: "Autora de prueba",
	knowledgeAreaIds: ["matematicas"],
};

type App = Hono<AuthEnv>;
type SessionUser = { id: string; role: string; email: string; name: string };

async function sessionUser(role: string): Promise<SessionUser> {
	const id = `${role}-${crypto.randomUUID()}`;
	const user = { id, role, email: `${id}@local.invalid`, name: `User ${id}` };
	await repo.ensureUser(getDb().db, user);
	return user;
}

function appFor(user: SessionUser): App {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", user as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	app.route("/api/v1/publish/resources", apiResourceRoutes);
	app.route("/api/uploads", uploadRoutes);
	return app;
}

async function adminAppFor(role: string) {
	const user = await sessionUser(role);
	return { app: appFor(user), user };
}

function publicApp(): App {
	const app = new Hono<AuthEnv>();
	app.route("/api/v1", publicRoutes);
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

function editMetadata(app: App, id: string, title: string) {
	return app.request(`/api/admin/resources/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title }),
	});
}

/** Lee la fila tal cual: `validated_by` no sale en las selecciones públicas. */
async function stored(id: string) {
	const [resource] = await getDb()
		.db.select()
		.from(resources)
		.where(eq(resources.id, id));
	if (!resource) throw new Error("recurso no encontrado");
	return resource;
}

/** Un author envía su recurso y un curator lo aprueba: queda con sello. */
async function approvedByCurator() {
	const author = await adminAppFor("author");
	const curator = await adminAppFor("curator");
	const id = await createComplete(author.app);
	expect((await changeStatus(author.app, id, "review")).status).toBe(200);
	expect((await changeStatus(curator.app, id, "published")).status).toBe(200);
	return { id, author, curator };
}

describe("cuándo se pone el sello (#420)", () => {
	test("«Aprobar y publicar» de un curator lo pone, con quién y cuándo", async () => {
		const { id, curator } = await approvedByCurator();

		const resource = await stored(id);
		expect(resource.editorialStatus).toBe("published");
		expect(resource.validatedAt).toBeInstanceOf(Date);
		expect(resource.validatedBy).toBe(curator.user.id);
		expect(resource.validationSource).toBe("review");
	});

	test("un admin cuenta como curator", async () => {
		const author = await adminAppFor("author");
		const admin = await adminAppFor("admin");
		const id = await createComplete(author.app);
		await changeStatus(author.app, id, "review");

		expect((await changeStatus(admin.app, id, "published")).status).toBe(200);

		const resource = await stored(id);
		expect(resource.validatedBy).toBe(admin.user.id);
		expect(resource.validationSource).toBe("review");
	});

	test("lo que publica directamente un editor queda sin sello", async () => {
		const editor = await adminAppFor("editor");
		const id = await createComplete(editor.app);

		expect((await changeStatus(editor.app, id, "published")).status).toBe(200);

		const resource = await stored(id);
		expect(resource.editorialStatus).toBe("published");
		expect(resource.validatedAt).toBeNull();
		expect(resource.validatedBy).toBeNull();
	});

	test("archivar lo conserva y restaurar a borrador lo quita", async () => {
		const { id, curator } = await approvedByCurator();

		expect((await changeStatus(curator.app, id, "archived")).status).toBe(200);
		expect((await stored(id)).validatedAt).toBeInstanceOf(Date);

		expect((await changeStatus(curator.app, id, "draft")).status).toBe(200);
		const resource = await stored(id);
		expect(resource.validatedAt).toBeNull();
		expect(resource.validatedBy).toBeNull();
		expect(resource.validationSource).toBeNull();
	});
});

describe("ediciones posteriores (#420)", () => {
	test("si el autor edita los metadatos, el recurso pierde el sello", async () => {
		const { id, author } = await approvedByCurator();

		expect(
			(await editMetadata(author.app, id, "Título cambiado por la autora"))
				.status,
		).toBe(200);

		const resource = await stored(id);
		expect(resource.title).toBe("Título cambiado por la autora");
		expect(resource.editorialStatus).toBe("published");
		expect(resource.validatedAt).toBeNull();
		expect(resource.validatedBy).toBeNull();
		expect(resource.validationSource).toBeNull();
	});

	for (const role of ["curator", "admin"]) {
		test(`si edita un ${role}, lo conserva`, async () => {
			const { id, curator } = await approvedByCurator();
			const before = await stored(id);
			const editor = role === "curator" ? curator : await adminAppFor("admin");

			expect(
				(await editMetadata(editor.app, id, `Corregido por ${role}`)).status,
			).toBe(200);

			const resource = await stored(id);
			expect(resource.title).toBe(`Corregido por ${role}`);
			expect(resource.validatedAt?.getTime()).toBe(
				before.validatedAt?.getTime(),
			);
			expect(resource.validatedBy).toBe(curator.user.id);
		});
	}

	test("la edición del autor por la API v1 también lo quita", async () => {
		const { id, author } = await approvedByCurator();

		const res = await author.app.request(`/api/v1/publish/resources/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ description: "Descripción nueva por la API" }),
		});

		expect(res.status).toBe(200);
		expect((await stored(id)).validatedAt).toBeNull();
	});

	test("cambiar las etiquetas del autor lo quita", async () => {
		const { id, author } = await approvedByCurator();

		const res = await author.app.request(`/api/admin/tags/resources/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ labels: ["geometría"] }),
		});

		expect(res.status).toBe(200);
		expect((await stored(id)).validatedAt).toBeNull();
	});

	test("subir un .elpx nuevo del autor lo quita; el de un curator, no", async () => {
		const { id, author, curator } = await approvedByCurator();

		const upload = (app: App) => {
			const form = new FormData();
			form.append(
				"file",
				new File([readFileSync(ELPX_FIXTURE)], "entrega.elpx", {
					type: "application/zip",
				}),
			);
			return app.request(`/api/admin/elpx/upload/${id}`, {
				method: "POST",
				body: form,
			});
		};

		expect((await upload(curator.app)).status).toBe(200);
		expect((await stored(id)).validatedAt).toBeInstanceOf(Date);

		expect((await upload(author.app)).status).toBe(200);
		expect((await stored(id)).validatedAt).toBeNull();
	});
});

describe("adjuntos (#420)", () => {
	function encodeMetadata(entries: Record<string, string>) {
		return Object.entries(entries)
			.map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
			.join(",");
	}

	async function attach(app: App, id: string) {
		const created = await app.request("/api/uploads", {
			method: "POST",
			headers: {
				"Tus-Resumable": "1.0.0",
				"Upload-Length": "11",
				"Upload-Metadata": encodeMetadata({
					resourceId: id,
					filename: "anexo.pdf",
					mimeType: "application/pdf",
				}),
			},
		});
		expect(created.status).toBe(201);
		const location = created.headers.get("location") ?? "";
		const patched = await app.request(location, {
			method: "PATCH",
			headers: {
				"Tus-Resumable": "1.0.0",
				"Upload-Offset": "0",
				"Content-Type": "application/offset+octet-stream",
			},
			body: "hola mundo!",
		});
		expect(patched.status).toBe(204);
	}

	test("un adjunto nuevo del autor lo quita; el de un curator, no", async () => {
		const { id, author, curator } = await approvedByCurator();

		await attach(curator.app, id);
		expect((await stored(id)).validatedAt).toBeInstanceOf(Date);

		await attach(author.app, id);
		expect((await stored(id)).validatedAt).toBeNull();
	});

	test("borrar un adjunto como autor lo quita", async () => {
		const { id, author, curator } = await approvedByCurator();
		await attach(curator.app, id);
		const [media] = await repo.listMediaItemsForResource(getDb().db, id);
		if (!media) throw new Error("sin adjunto");

		const res = await author.app.request(
			`/api/admin/resources/${id}/media/${media.id}`,
			{ method: "DELETE" },
		);

		expect(res.status).toBe(200);
		expect((await stored(id)).validatedAt).toBeNull();
	});
});

describe("dónde se ve (#420)", () => {
	test("la ficha pública y el listado exponen el sello, sin quién lo dio", async () => {
		const { id } = await approvedByCurator();
		const { slug } = await stored(id);
		const app = publicApp();

		const detail = (await (
			await app.request(`/api/v1/resources/${slug}`)
		).json()) as Record<string, unknown>;
		expect(detail.validatedAt).toBeTruthy();
		expect(detail.validationSource).toBe("review");
		expect(detail).not.toHaveProperty("validatedBy");

		const list = (await (
			await app.request("/api/v1/resources?limit=100")
		).json()) as { data: Array<Record<string, unknown>> };
		const card = list.data.find((item) => item.id === id);
		expect(card?.validatedAt).toBeTruthy();
		expect(card?.validationSource).toBe("review");
		expect(card).not.toHaveProperty("validatedBy");
	});
});
