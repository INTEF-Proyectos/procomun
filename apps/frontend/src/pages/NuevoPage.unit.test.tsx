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
				keywords: "fracciones, primaria",
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
			keywords: "fracciones, primaria",
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
				keywords: "manual",
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
			keywords: "manual",
		});
	});
});
