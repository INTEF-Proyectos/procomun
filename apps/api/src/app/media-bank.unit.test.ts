import { describe, expect, test } from "bun:test";
import { resolveMediaBankUrl } from "./media-bank.ts";

describe("resolveMediaBankUrl (#569)", () => {
	test("sin MEDIA_BANK_URL no hay enlace", () => {
		expect(resolveMediaBankUrl({})).toBeNull();
		expect(resolveMediaBankUrl({ MEDIA_BANK_URL: "" })).toBeNull();
		expect(resolveMediaBankUrl({ MEDIA_BANK_URL: "   " })).toBeNull();
	});

	test("devuelve la URL http o https configurada, sin espacios", () => {
		expect(
			resolveMediaBankUrl({
				MEDIA_BANK_URL: " https://multimedia.example.es/ ",
			}),
		).toBe("https://multimedia.example.es/");
		expect(
			resolveMediaBankUrl({ MEDIA_BANK_URL: "http://localhost:8080/banco" }),
		).toBe("http://localhost:8080/banco");
	});

	test("descarta valores que no son una URL http o https", () => {
		for (const value of [
			"javascript:alert(1)",
			"data:text/html,hola",
			"ftp://multimedia.example.es",
			"multimedia.example.es",
			"/banco",
		]) {
			expect(resolveMediaBankUrl({ MEDIA_BANK_URL: value })).toBeNull();
		}
	});

	test("exige la doble barra y devuelve la URL normalizada", () => {
		for (const value of [
			"https:banco.example.org",
			"http:/banco.example.org",
		]) {
			expect(resolveMediaBankUrl({ MEDIA_BANK_URL: value })).toBeNull();
		}
		expect(
			resolveMediaBankUrl({ MEDIA_BANK_URL: "HTTPS://Banco.Example.org" }),
		).toBe("https://banco.example.org/");
	});
});
