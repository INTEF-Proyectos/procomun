import { describe, expect, test } from "bun:test";
import {
	COUNTRY_CODES,
	PROFILE_LIMITS,
	validateProfileUpdate,
	validateUserNameAndBio,
} from "./user-profile.ts";

function errorsOf(result: ReturnType<typeof validateProfileUpdate>) {
	return result.ok
		? []
		: result.errors.map(({ field, code }) => ({ field, code }));
}

describe("validateUserNameAndBio (#533)", () => {
	test("rechaza un nombre vacío, en blanco o que no es texto", () => {
		for (const name of ["", "   ", null, 42]) {
			const result = validateUserNameAndBio({ name });
			expect(errorsOf(result)).toEqual([{ field: "name", code: "required" }]);
		}
	});

	test("rechaza un nombre y un «Sobre mí» demasiado largos", () => {
		const result = validateUserNameAndBio({
			name: "a".repeat(PROFILE_LIMITS.name + 1),
			bio: "b".repeat(PROFILE_LIMITS.bio + 1),
		});
		expect(errorsOf(result)).toEqual([
			{ field: "name", code: "too_long" },
			{ field: "bio", code: "too_long" },
		]);
	});

	test("recorta espacios y guarda un «Sobre mí» vacío como null", () => {
		const result = validateUserNameAndBio({ name: "  Ana  ", bio: "   " });
		expect(result).toEqual({ ok: true, value: { name: "Ana", bio: null } });
	});

	test("solo devuelve los campos que llegan", () => {
		expect(validateUserNameAndBio({ bio: "Hola\r\nmundo" })).toEqual({
			ok: true,
			value: { bio: "Hola\nmundo" },
		});
		expect(validateUserNameAndBio({})).toEqual({ ok: true, value: {} });
	});
});

describe("validateProfileUpdate (#533)", () => {
	test("normaliza los datos ampliados del perfil", () => {
		const result = validateProfileUpdate({
			name: "Ana",
			profile: {
				countryCode: "es",
				locality: "  Burgos ",
				educationalCenter: "CEIP Ejemplo",
				educationalCenterUrl: "ceip-ejemplo.es",
				website: "https://ana.example/blog",
				facebook: "",
				twitter: "@ana",
				linkedin: null,
			},
		});
		expect(result).toEqual({
			ok: true,
			value: {
				name: "Ana",
				profile: {
					countryCode: "ES",
					locality: "Burgos",
					educationalCenter: "CEIP Ejemplo",
					educationalCenterUrl: "https://ceip-ejemplo.es/",
					website: "https://ana.example/blog",
					facebook: null,
					twitter: "@ana",
					linkedin: null,
				},
			},
		});
	});

	test("ignora campos que no son del perfil", () => {
		const result = validateProfileUpdate({
			profile: { locality: "Soria", about: "x", userId: "otro" },
		});
		expect(result).toEqual({
			ok: true,
			value: { profile: { locality: "Soria" } },
		});
	});

	test("rechaza país desconocido, URL no web y textos largos", () => {
		const result = validateProfileUpdate({
			profile: {
				countryCode: "XX",
				website: "javascript:alert(1)",
				educationalCenterUrl: "no es una url",
				locality: "l".repeat(PROFILE_LIMITS.shortText + 1),
				twitter: 7,
			},
		});
		expect(errorsOf(result)).toEqual([
			{ field: "profile.countryCode", code: "invalid_country" },
			{ field: "profile.locality", code: "too_long" },
			{ field: "profile.educationalCenterUrl", code: "invalid_url" },
			{ field: "profile.website", code: "invalid_url" },
			{ field: "profile.twitter", code: "invalid_type" },
		]);
	});

	test("rechaza un perfil que no es un objeto", () => {
		expect(errorsOf(validateProfileUpdate({ profile: "x" }))).toEqual([
			{ field: "profile", code: "invalid_type" },
		]);
	});

	test("la lista de países son códigos ISO 3166-1 alfa-2", () => {
		expect(COUNTRY_CODES).toContain("ES");
		expect(COUNTRY_CODES).toContain("PT");
		expect(COUNTRY_CODES).not.toContain("XX");
		expect(COUNTRY_CODES.length).toBe(249);
		expect(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBeTrue();
	});
});
