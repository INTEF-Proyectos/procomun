import { describe, expect, test } from "bun:test";
import {
	applyElpxMetadataToForm,
	EMPTY_FORM,
	resourceTypeSelectionError,
} from "./NuevoPage.tsx";

describe("NuevoPage helpers", () => {
	test("el alta empieza sin tipo de recurso y el placeholder no vale", () => {
		expect(EMPTY_FORM.resourceType).toBe("");
		expect(resourceTypeSelectionError("")).toBe(
			"Selecciona un tipo de recurso",
		);
		expect(resourceTypeSelectionError("Selecciona un tipo de recurso")).toBe(
			"Selecciona un tipo de recurso",
		);
		expect(resourceTypeSelectionError("documento")).toBeNull();
	});

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
			resourceType: "documento",
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
			resourceType: "documento",
			keywords: "manual",
		});
	});

	test("applyElpxMetadataToForm no preselecciona tipo de recurso", () => {
		const result = applyElpxMetadataToForm(
			{
				title: "",
				description: "",
				author: "",
				language: "es",
				license: "cc-by",
				resourceType: "",
				keywords: "",
			},
			{ title: "Proyecto eXe" },
		);

		expect(result.resourceType).toBe("");
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
				keywords: "",
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
			resourceType: "documento",
			keywords: "",
		});
	});
});
