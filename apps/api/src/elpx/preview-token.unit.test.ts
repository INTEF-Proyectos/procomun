import { afterEach, describe, expect, test } from "bun:test";
import {
	buildSignedElpxPreviewUrl,
	createElpxPreviewToken,
	ELPX_PREVIEW_TTL_SECONDS,
	elpxPreviewUrlForStatus,
	verifyElpxPreviewToken,
} from "./preview-token.ts";

const HASH = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);
const originalSecret = process.env.BETTER_AUTH_SECRET;

afterEach(() => {
	if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
	else process.env.BETTER_AUTH_SECRET = originalSecret;
});

describe("token de vista previa del .elpx (#466)", () => {
	test("un token recién emitido es válido para su hash", () => {
		const token = createElpxPreviewToken(HASH, NOW);
		expect(verifyElpxPreviewToken(HASH, token, NOW)).toBe(true);
	});

	test("caduca a las dos horas", () => {
		const token = createElpxPreviewToken(HASH, NOW);
		const ttlMs = ELPX_PREVIEW_TTL_SECONDS * 1000;
		expect(ELPX_PREVIEW_TTL_SECONDS).toBe(7200);
		expect(verifyElpxPreviewToken(HASH, token, NOW + ttlMs - 1000)).toBe(true);
		expect(verifyElpxPreviewToken(HASH, token, NOW + ttlMs)).toBe(false);
	});

	test("no vale para otro hash", () => {
		const token = createElpxPreviewToken(HASH, NOW);
		expect(verifyElpxPreviewToken(OTHER, token, NOW)).toBe(false);
	});

	test("rechaza una caducidad alargada o una firma alterada", () => {
		const token = createElpxPreviewToken(HASH, NOW);
		const [exp, sig] = token.split(".") as [string, string];
		expect(
			verifyElpxPreviewToken(HASH, `${Number(exp) + 3600}.${sig}`, NOW),
		).toBe(false);
		const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
		expect(verifyElpxPreviewToken(HASH, `${exp}.${flipped}`, NOW)).toBe(false);
		expect(verifyElpxPreviewToken(HASH, "basura", NOW)).toBe(false);
		expect(verifyElpxPreviewToken(HASH, "", NOW)).toBe(false);
	});

	test("un token firmado con otro secreto no es válido", () => {
		process.env.BETTER_AUTH_SECRET = "secreto-uno-con-longitud-suficiente-1";
		const token = createElpxPreviewToken(HASH, NOW);
		process.env.BETTER_AUTH_SECRET = "secreto-dos-con-longitud-suficiente-2";
		expect(verifyElpxPreviewToken(HASH, token, NOW)).toBe(false);
	});

	test("la URL firmada cuelga de /api/v1/elpx/preview/<hash>/<token>/", () => {
		const url = buildSignedElpxPreviewUrl(HASH, NOW);
		const token = url.split("/").at(-2) as string;
		expect(url).toBe(`/api/v1/elpx/preview/${HASH}/${token}/`);
		expect(verifyElpxPreviewToken(HASH, token, NOW)).toBe(true);
	});

	test("un recurso publicado conserva la URL estable; el resto se firma", () => {
		expect(elpxPreviewUrlForStatus(HASH, "published", NOW)).toBe(
			`/api/v1/elpx/${HASH}/`,
		);
		for (const status of ["draft", "review", "unpublished", null, undefined]) {
			expect(
				elpxPreviewUrlForStatus(HASH, status, NOW).startsWith(
					`/api/v1/elpx/preview/${HASH}/`,
				),
			).toBe(true);
		}
	});
});
