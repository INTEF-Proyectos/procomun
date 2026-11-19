import { describe, expect, test } from "bun:test";
import { validateCreateResource } from "@procomun/db/validation";
import { renderToStaticMarkup } from "react-dom/server";
import {
	applyElpxMetadataToForm,
	buildCreateResourceBody,
	MediaBankHint,
} from "./NuevoPage.tsx";

describe("enlace al banco multimedia en /nuevo (#569)", () => {
	test("sin URL configurada no aparece", () => {
		expect(renderToStaticMarkup(<MediaBankHint href={null} />)).toBe("");
	});

	test("con URL ofrece el banco a quien sube imágenes, vídeo o audio", () => {
		const html = renderToStaticMarkup(
			<MediaBankHint href="https://multimedia.example.es/" />,
		);
		expect(html).toContain("imágenes, vídeo o audio");
		expect(html).toContain(
			'<a href="https://multimedia.example.es/">Ir al banco multimedia</a>',
		);
	});
});

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

	test("buildCreateResourceBody envía las áreas y solo con FP las familias (#448)", () => {
		const form = {
			title: "Recurso",
			description: "Descripción",
			author: "Ana Pérez",
			otherAuthors: "",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		};
		const fp = [{ categoryId: "formacion-profesional", optionId: null }];
		const body = buildCreateResourceBody(form, fp, [], {
			knowledgeAreaIds: ["ingles"],
			professionalFamilyIds: ["hosteleria-y-turismo"],
		});
		expect(body.knowledgeAreaIds).toEqual(["ingles"]);
		expect(body.professionalFamilyIds).toEqual(["hosteleria-y-turismo"]);
		expect(validateCreateResource(body).valid).toBe(true);

		const withoutFp = buildCreateResourceBody(
			form,
			[{ categoryId: "bachillerato", optionId: null }],
			[],
			{ knowledgeAreaIds: [], professionalFamilyIds: ["sanidad"] },
		);
		expect(withoutFp.professionalFamilyIds).toEqual([]);
		// Un borrador se puede guardar sin áreas.
		expect(validateCreateResource(withoutFp).valid).toBe(true);
	});
});
