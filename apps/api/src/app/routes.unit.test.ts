import { describe, expect, test } from "bun:test";
import { createUserWithCredentials } from "@procomun/db/repository";
import { collections, reports, resources } from "@procomun/db/schema";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createApp } from "../app.ts";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb, waitForDb } from "../db.ts";
import { registerRoutes } from "./routes.ts";

describe("registerRoutes", () => {
	test("registers health and config endpoints", async () => {
		const app = new Hono<AuthEnv>();
		registerRoutes(app);

		const healthResponse = await app.request("/health");
		expect(healthResponse.status).toBe(200);
		expect(await healthResponse.json()).toEqual({ status: "ok" });

		const configResponse = await app.request("/api/v1/config");
		expect(configResponse.status).toBe(200);
		const config = await configResponse.json();
		expect(typeof config.oidcEnabled).toBe("boolean");
		expect(typeof config.emailVerificationRequired).toBe("boolean");
		expect("oidcEndSessionUrl" in config).toBe(true);
		// #551: la interfaz esconde la recuperación si no se puede mandar correo.
		expect(config.emailDeliveryEnabled).toBe(true);
	});

	test("expone mediaBankUrl desde MEDIA_BANK_URL (#569)", async () => {
		const previous = process.env.MEDIA_BANK_URL;
		try {
			const app = new Hono<AuthEnv>();
			registerRoutes(app);

			delete process.env.MEDIA_BANK_URL;
			let config = await (await app.request("/api/v1/config")).json();
			expect(config.mediaBankUrl).toBeNull();

			process.env.MEDIA_BANK_URL = "https://multimedia.example.es/";
			config = await (await app.request("/api/v1/config")).json();
			expect(config.mediaBankUrl).toBe("https://multimedia.example.es/");
		} finally {
			if (previous === undefined) delete process.env.MEDIA_BANK_URL;
			else process.env.MEDIA_BANK_URL = previous;
		}
	});

	test("expone el catálogo de áreas de conocimiento sin sesión (#448)", async () => {
		const app = new Hono<AuthEnv>();
		registerRoutes(app);
		const response = await app.request("/api/v1/knowledge-areas");
		expect(response.status).toBe(200);
		expect((await response.json()).blocks).toHaveLength(9);
	});
});

test("una sesión real permite denunciar recursos y colecciones publicados (#625)", async () => {
	await waitForDb();
	const { db } = getDb();
	const email = "reporter-625@example.test";
	const password = "Denuncias-625!";
	const reporter = await createUserWithCredentials(db, {
		email,
		name: "Cuenta de prueba",
		role: "reader",
		passwordHash: await hashPassword(password),
	});
	if (!reporter) throw new Error("No se creó la cuenta de prueba");

	const resource = {
		title: "Recurso de prueba",
		description: "Prueba",
		license: "cc-by",
		resourceType: "documento",
	};
	const collection = {
		title: "Colección de prueba",
		description: "Prueba",
		curatorId: reporter.id,
	};
	await db.insert(resources).values([
		{
			...resource,
			id: "625-resource",
			slug: "625-resource",
			editorialStatus: "published",
		},
		{
			...resource,
			id: "625-resource-draft",
			slug: "625-resource-draft",
			editorialStatus: "draft",
		},
	]);
	await db.insert(collections).values([
		{
			...collection,
			id: "625-collection",
			slug: "625-collection",
			editorialStatus: "published",
		},
		{
			...collection,
			id: "625-collection-draft",
			slug: "625-collection-draft",
			editorialStatus: "draft",
		},
	]);

	const app = createApp();
	const origin = "http://localhost:4321";
	const login = await app.request(`${origin}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", origin },
		body: JSON.stringify({ email, password }),
	});
	expect(login.status).toBe(200);
	const cookie = login.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const getSession = await app.request(`${origin}/api/auth/get-session`, {
		headers: { cookie },
	});
	expect(await getSession.json()).toMatchObject({ user: { id: reporter.id } });

	const report = (target: string, sessionCookie = "") =>
		app.request(`/api/v1/${target}/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie: sessionCookie },
			body: JSON.stringify({ reason: "spam" }),
		});

	for (const [target, slug] of [
		["resources", "625-resource"],
		["collections", "625-collection"],
	]) {
		expect((await report(`${target}/${slug}`)).status).toBe(401);
		expect((await report(`${target}/${slug}`, cookie)).status).toBe(201);
		expect((await report(`${target}/${slug}-draft`, cookie)).status).toBe(404);
	}
	const stored = await db
		.select({
			resourceId: reports.resourceId,
			collectionId: reports.collectionId,
			status: reports.status,
			reason: reports.reason,
		})
		.from(reports)
		.where(eq(reports.reporterId, reporter.id));
	expect(stored).toHaveLength(2);
	expect(stored).toEqual(
		expect.arrayContaining([
			{
				resourceId: "625-resource",
				collectionId: null,
				status: "pending",
				reason: "spam",
			},
			{
				resourceId: null,
				collectionId: "625-collection",
				status: "pending",
				reason: "spam",
			},
		]),
	);
});
