import { beforeEach, describe, expect, test } from "bun:test";
import {
	loadMediaBankUrl,
	resetMediaBankUrlCache,
	safeMediaBankUrl,
} from "./media-bank.ts";

describe("URL del banco multimedia (#569)", () => {
	beforeEach(() => resetMediaBankUrlCache());

	test("solo acepta URL http o https", () => {
		expect(safeMediaBankUrl("https://multimedia.example.es/")).toBe(
			"https://multimedia.example.es/",
		);
		expect(safeMediaBankUrl("http://localhost:8080/banco")).toBe(
			"http://localhost:8080/banco",
		);
		expect(safeMediaBankUrl("javascript:alert(1)")).toBeNull();
		expect(safeMediaBankUrl("/banco")).toBeNull();
		expect(safeMediaBankUrl("")).toBeNull();
		expect(safeMediaBankUrl(undefined)).toBeNull();
		expect(safeMediaBankUrl(null)).toBeNull();
	});

	test("exige la doble barra y devuelve la URL normalizada", () => {
		expect(safeMediaBankUrl("https:banco.example.org")).toBeNull();
		expect(safeMediaBankUrl("http:/banco.example.org")).toBeNull();
		expect(safeMediaBankUrl("HTTPS://Banco.Example.org")).toBe(
			"https://banco.example.org/",
		);
	});

	test("lee la URL de /api/v1/config una sola vez", async () => {
		let calls = 0;
		const getConfig = async () => {
			calls += 1;
			return { mediaBankUrl: "https://multimedia.example.es/" };
		};
		expect(await loadMediaBankUrl(getConfig)).toBe(
			"https://multimedia.example.es/",
		);
		expect(await loadMediaBankUrl(getConfig)).toBe(
			"https://multimedia.example.es/",
		);
		expect(calls).toBe(1);
	});

	test("sin mediaBankUrl en la configuración no hay enlace", async () => {
		expect(await loadMediaBankUrl(async () => ({}))).toBeNull();
	});

	test("si la configuración falla, no hay enlace", async () => {
		expect(
			await loadMediaBankUrl(async () => {
				throw new Error("sin red");
			}),
		).toBeNull();
	});
});
