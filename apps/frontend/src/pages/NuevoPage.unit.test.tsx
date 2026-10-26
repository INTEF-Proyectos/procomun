import { describe, expect, test } from "bun:test";
import { applyElpxMetadataToForm } from "./NuevoPage.tsx";

describe("NuevoPage helpers", () => {
	test("applyElpxMetadataToForm precarga los campos extraidos del .elpx", () => {
		const result = applyElpxMetadataToForm(
			{
				title: "",
				description: "",
				author: "",
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
			language: "es",
			license: "cc-by",
			resourceType: "actividad-interactiva",
		});
	});
});
