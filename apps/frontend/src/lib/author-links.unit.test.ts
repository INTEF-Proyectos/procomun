import { describe, expect, test } from "bun:test";
import {
	authorProfileHref,
	publisherProfileId,
	splitAuthorNames,
} from "./author-links.ts";
import { searchHref } from "./resource-display.ts";

describe("splitAuthorNames (#458)", () => {
	test("separa por comas y quita la coletilla «… para Cedec»", () => {
		expect(
			splitAuthorNames(
				"Mª del Mar Pérez Gómez, Irene González Mendizabal… para Cedec",
			),
		).toEqual(["Mª del Mar Pérez Gómez", "Irene González Mendizabal"]);
	});

	test("admite puntos suspensivos ASCII, punto y coma y espacios sobrantes", () => {
		expect(splitAuthorNames("  Ana López ;Juan Pérez...  para INTEF ")).toEqual(
			["Ana López", "Juan Pérez"],
		);
	});

	test("no recorta nombres de organización con «para» en medio", () => {
		expect(splitAuthorNames("Ministerio para la Transición Ecológica")).toEqual(
			["Ministerio para la Transición Ecológica"],
		);
	});

	test("descarta vacíos y duplicados", () => {
		expect(splitAuthorNames("Ana, , ana , Luis,")).toEqual(["Ana", "Luis"]);
	});

	test("sin autor devuelve una lista vacía", () => {
		expect(splitAuthorNames(null)).toEqual([]);
		expect(splitAuthorNames(undefined)).toEqual([]);
		expect(splitAuthorNames("  ")).toEqual([]);
	});
});

describe("enlaces de autor (#458)", () => {
	test("la ficha de quien publica usa su id codificado", () => {
		expect(authorProfileHref("legacy-procomun:user:42")).toBe(
			"/autor/legacy-procomun%3Auser%3A42",
		);
	});

	test("cada nombre de autor lanza una búsqueda con el nombre completo", () => {
		expect(searchHref("Mª del Mar Pérez")).toBe(
			"/explorar?q=M%C2%AA%20del%20Mar%20P%C3%A9rez",
		);
	});
});

describe("publisherProfileId (#541)", () => {
	test("con cuenta activa devuelve su id", () => {
		expect(
			publisherProfileId({
				createdBy: "u1",
				createdByName: "Ana",
				createdByActive: true,
			}),
		).toBe("u1");
	});

	test("una cuenta dada de baja no tiene ficha que enlazar", () => {
		expect(
			publisherProfileId({
				createdBy: "u1",
				createdByName: "Ana",
				createdByActive: false,
			}),
		).toBeNull();
	});

	test("sin cuenta o sin nombre tampoco", () => {
		expect(
			publisherProfileId({ createdBy: null, createdByName: "Ana" }),
		).toBeNull();
		expect(
			publisherProfileId({ createdBy: "u1", createdByName: null }),
		).toBeNull();
	});

	test("si la respuesta no trae el dato se mantiene el enlace", () => {
		expect(publisherProfileId({ createdBy: "u1", createdByName: "Ana" })).toBe(
			"u1",
		);
	});
});
