import { describe, expect, test } from "bun:test";
import { validateCreateResource } from "@procomun/db/validation";
import {
	applyElpxMetadataToForm,
	buildCreateResourceBody,
} from "./NuevoPage.tsx";

describe("NuevoPage helpers", () => {
	test("applyElpxMetadataToForm precarga los campos extraidos del .elpx", () => {
		const result = applyElpxMetadataToForm(
			{
				title: "",
				description: "",
				author: "",
				otherAuthors: "",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
			},
			{
				title: "Proyecto eXe",
				description: "Secuencia didactica de prueba",
				author: "Equipo docente",
				language: "en",
				license: "cc0",
			},
		);

		expect(result).toEqual({
			title: "Proyecto eXe",
			description: "Secuencia didactica de prueba",
			author: "Equipo docente",
			otherAuthors: "",
			language: "en",
			license: "cc0",
			resourceType: "actividad-interactiva",
		});
	});

	test("applyElpxMetadataToForm conserva valores existentes cuando faltan metadatos", () => {
		const result = applyElpxMetadataToForm(
			{
				title: "Titulo manual",
				description: "Descripcion manual",
				author: "Autor manual",
				otherAuthors: "Coautora manual",
				language: "gl",
				license: "cc-by-sa",
				resourceType: "documento",
			},
			{},
		);

		expect(result).toEqual({
			title: "Titulo manual",
			description: "Descripcion manual",
			author: "Autor manual",
			otherAuthors: "Coautora manual",
			language: "gl",
			license: "cc-by-sa",
			resourceType: "actividad-interactiva",
		});
	});

	test("applyElpxMetadataToForm conserva defaults si el .elpx trae language o license no validos", () => {
		const result = applyElpxMetadataToForm(
			{
				title: "",
				description: "",
				author: "",
				otherAuthors: "",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
			},
			{
				language: "es-ES",
				license: "creative commons: attribution - share alike 4.0",
			},
		);

		expect(result).toEqual({
			title: "",
			description: "",
			author: "",
			otherAuthors: "",
			language: "es",
			license: "cc-by",
			resourceType: "actividad-interactiva",
		});
	});

	test("buildCreateResourceBody envía «Otros autores» solo si tiene contenido (#417)", () => {
		const form = {
			title: "Recurso",
			description: "Descripción",
			author: "Ana Pérez",
			otherAuthors: " Luis Gómez, Marta Ruiz ",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		};

		const body = buildCreateResourceBody(form, []);
		expect(body.otherAuthors).toBe("Luis Gómez, Marta Ruiz");
		expect(validateCreateResource(body).valid).toBe(true);

		expect(
			buildCreateResourceBody({ ...form, otherAuthors: "   " }, [])
				.otherAuthors,
		).toBeUndefined();
	});
});
