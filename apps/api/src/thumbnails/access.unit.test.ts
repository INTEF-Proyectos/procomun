import { afterEach, describe, expect, test } from "bun:test";
import {
	createElpxPreviewToken,
	ELPX_PREVIEW_TTL_SECONDS,
	verifyElpxPreviewToken,
} from "../elpx/preview-token.ts";
import {
	buildSignedThumbnailUrl,
	createThumbnailToken,
	THUMBNAIL_SIGNED_PREFIX,
	thumbnailUrlForStatus,
	thumbnailUrlForViewer,
	verifyThumbnailToken,
} from "./access.ts";

const FILE = `${"a".repeat(64)}.jpg`;
const OTHER = `${"b".repeat(64)}.jpg`;
const PUBLIC_URL = `/api/v1/thumbnails/${FILE}`;
const NOW = Date.UTC(2026, 10, 3, 10, 0, 0);
const originalSecret = process.env.BETTER_AUTH_SECRET;

afterEach(() => {
	if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
	else process.env.BETTER_AUTH_SECRET = originalSecret;
});

// Revisión de #481: la miniatura de un recurso no publicado solo sale con un
// enlace firmado, con el mismo mecanismo que la vista previa de #466.
describe("token de miniatura", () => {
	test("vale para su fichero y caduca a las dos horas, como la vista previa", () => {
		const token = createThumbnailToken(FILE, NOW);
		const ttlMs = ELPX_PREVIEW_TTL_SECONDS * 1000;
		expect(verifyThumbnailToken(FILE, token, NOW)).toBe(true);
		expect(verifyThumbnailToken(FILE, token, NOW + ttlMs - 1000)).toBe(true);
		expect(verifyThumbnailToken(FILE, token, NOW + ttlMs)).toBe(false);
	});

	test("no vale para otro fichero", () => {
		const token = createThumbnailToken(FILE, NOW);
		expect(verifyThumbnailToken(OTHER, token, NOW)).toBe(false);
	});

	test("rechaza una caducidad alargada, una firma alterada o basura", () => {
		const token = createThumbnailToken(FILE, NOW);
		const [exp, sig] = token.split(".") as [string, string];
		expect(
			verifyThumbnailToken(FILE, `${Number(exp) + 3600}.${sig}`, NOW),
		).toBe(false);
		const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
		expect(verifyThumbnailToken(FILE, `${exp}.${flipped}`, NOW)).toBe(false);
		expect(verifyThumbnailToken(FILE, "basura", NOW)).toBe(false);
		expect(verifyThumbnailToken(FILE, "", NOW)).toBe(false);
	});

	test("un token de la vista previa del paquete no vale como token de miniatura, ni al revés", () => {
		const previewToken = createElpxPreviewToken(FILE, NOW);
		expect(verifyThumbnailToken(FILE, previewToken, NOW)).toBe(false);
		const thumbnailToken = createThumbnailToken(FILE, NOW);
		expect(verifyElpxPreviewToken(FILE, thumbnailToken, NOW)).toBe(false);
	});

	test("un token firmado con otro secreto no es válido", () => {
		process.env.BETTER_AUTH_SECRET = "secreto-uno-con-longitud-suficiente-1";
		const token = createThumbnailToken(FILE, NOW);
		process.env.BETTER_AUTH_SECRET = "secreto-dos-con-longitud-suficiente-2";
		expect(verifyThumbnailToken(FILE, token, NOW)).toBe(false);
	});

	test("la URL firmada es /api/v1/thumbnails/signed/<token>/<fichero>", () => {
		const url = buildSignedThumbnailUrl(FILE, NOW);
		expect(url.startsWith(THUMBNAIL_SIGNED_PREFIX)).toBe(true);
		expect(THUMBNAIL_SIGNED_PREFIX).toBe("/api/v1/thumbnails/signed/");
		const [token, file] = url.slice(THUMBNAIL_SIGNED_PREFIX.length).split("/");
		expect(file).toBe(FILE);
		expect(verifyThumbnailToken(FILE, token as string, NOW)).toBe(true);
	});
});

describe("thumbnailUrlForStatus", () => {
	test("publicado: la URL estable, sin token", () => {
		expect(thumbnailUrlForStatus(PUBLIC_URL, "published", NOW)).toBe(
			PUBLIC_URL,
		);
	});

	test("borrador, revisión o archivado: el enlace firmado del mismo fichero", () => {
		for (const status of ["draft", "review", "archived"]) {
			const url = thumbnailUrlForStatus(PUBLIC_URL, status, NOW) as string;
			expect(url).toBe(buildSignedThumbnailUrl(FILE, NOW));
		}
	});

	test("sin estado conocido no se da la URL estable", () => {
		for (const status of [null, undefined, ""]) {
			const url = thumbnailUrlForStatus(PUBLIC_URL, status, NOW) as string;
			expect(url.startsWith(THUMBNAIL_SIGNED_PREFIX)).toBe(true);
		}
	});

	test("sin URL, null", () => {
		expect(thumbnailUrlForStatus(null, "draft", NOW)).toBeNull();
		expect(thumbnailUrlForStatus(undefined, "published", NOW)).toBeNull();
		expect(thumbnailUrlForStatus("  ", "published", NOW)).toBeNull();
	});

	test("una URL nuestra con un nombre que no es del almacén se descarta", () => {
		for (const url of [
			"/api/v1/thumbnails/../secreto.txt",
			`/api/v1/thumbnails/${"a".repeat(64)}.svg`,
			"/api/v1/thumbnails/",
		]) {
			expect(thumbnailUrlForStatus(url, "published", NOW)).toBeNull();
			expect(thumbnailUrlForStatus(url, "draft", NOW)).toBeNull();
		}
	});

	test("una URL externa (preview legacy sin copiar) se deja como está", () => {
		const external = "https://ode.educacion.es/imagen.png";
		expect(thumbnailUrlForStatus(external, "draft", NOW)).toBe(external);
		expect(thumbnailUrlForStatus(external, "published", NOW)).toBe(external);
	});
});

describe("thumbnailUrlForViewer", () => {
	const author = { id: "autora", role: "author" };
	const stranger = { id: "ajena", role: "author" };
	const curator = { id: "curator", role: "curator" };

	test("publicado: la URL estable para cualquiera, también sin sesión", () => {
		const row = {
			thumbnailUrl: PUBLIC_URL,
			editorialStatus: "published",
			createdBy: "autora",
		};
		expect(thumbnailUrlForViewer(row, null, NOW)).toBe(PUBLIC_URL);
		expect(thumbnailUrlForViewer(row, stranger, NOW)).toBe(PUBLIC_URL);
	});

	test("no publicado: firmada si puede verlo y null si no", () => {
		const draft = {
			thumbnailUrl: PUBLIC_URL,
			editorialStatus: "draft",
			createdBy: "autora",
		};
		expect(thumbnailUrlForViewer(draft, author, NOW)).toBe(
			buildSignedThumbnailUrl(FILE, NOW),
		);
		expect(thumbnailUrlForViewer(draft, stranger, NOW)).toBeNull();
		expect(thumbnailUrlForViewer(draft, curator, NOW)).toBeNull();
		expect(thumbnailUrlForViewer(draft, null, NOW)).toBeNull();

		const archived = { ...draft, editorialStatus: "archived" };
		expect(thumbnailUrlForViewer(archived, curator, NOW)).toBe(
			buildSignedThumbnailUrl(FILE, NOW),
		);
		expect(thumbnailUrlForViewer(archived, stranger, NOW)).toBeNull();
	});
});
