import { describe, expect, test } from "bun:test";
import {
	KNOWLEDGE_AREA_FIELD,
	KNOWLEDGE_AREA_MESSAGES,
	PROFESSIONAL_FAMILY_FIELD,
} from "@procomun/db/knowledge-areas";
import {
	validateCollection,
	validateCreateResource,
	validateResourceForStatus,
	validateResourceUpdateForStatus,
	validateStatus,
	validateTaxonomy,
	validateTransition,
	validateUpdateResource,
} from "@procomun/db/validation";

const validPayload = {
	title: "Recurso de ejemplo",
	description: "Descripción del recurso educativo",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	author: "Autor de ejemplo",
};

describe("validateCreateResource", () => {
	test("payload válido pasa", () => {
		const r = validateCreateResource(validPayload);
		expect(r.valid).toBe(true);
		expect(r.errors).toHaveLength(0);
	});

	test("payload con campos opcionales pasa", () => {
		const r = validateCreateResource({
			...validPayload,
			author: "Autor",
			keywords: "math, science",
			publisher: "Editorial",
			subjects: ["Matemáticas"],
			levels: ["Primaria"],
		});
		expect(r.valid).toBe(true);
	});

	test("falta title da error específico", () => {
		const { title, ...rest } = validPayload;
		const r = validateCreateResource(rest);
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "title")).toBeTruthy();
	});

	test("falta description da error", () => {
		const { description, ...rest } = validPayload;
		const r = validateCreateResource(rest);
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "description")).toBeTruthy();
	});

	test("falta language da error", () => {
		const { language, ...rest } = validPayload;
		const r = validateCreateResource(rest);
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "language")).toBeTruthy();
	});

	test("falta license da error", () => {
		const { license, ...rest } = validPayload;
		const r = validateCreateResource(rest);
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "license")).toBeTruthy();
	});

	test("falta resourceType da error", () => {
		const { resourceType, ...rest } = validPayload;
		const r = validateCreateResource(rest);
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "resourceType")).toBeTruthy();
	});

	test("author ausente, vacío o solo espacios se rechaza al crear", () => {
		for (const author of [undefined, "", "   "]) {
			const r = validateCreateResource({ ...validPayload, author });
			expect(r.valid).toBe(false);
			expect(r.errors.find((e) => e.field === "author")?.message).toBe(
				"El autor es obligatorio",
			);
		}
	});

	test("tipo y autor vacíos se informan en la misma validación", () => {
		const r = validateCreateResource({
			...validPayload,
			resourceType: "",
			author: "",
		});
		expect(r.errors.map((e) => e.field).sort()).toEqual([
			"author",
			"resourceType",
		]);
	});

	test("title excede 500 caracteres", () => {
		const r = validateCreateResource({
			...validPayload,
			title: "x".repeat(501),
		});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "title")?.message).toContain("500");
	});

	test("description excede 5000 caracteres", () => {
		const r = validateCreateResource({
			...validPayload,
			description: "x".repeat(5001),
		});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "description")?.message).toContain(
			"5000",
		);
	});

	test("language inválido rechazado", () => {
		const r = validateCreateResource({ ...validPayload, language: "zz" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "language")).toBeTruthy();
	});

	test("license inválida rechazada", () => {
		const r = validateCreateResource({ ...validPayload, license: "mit" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "license")).toBeTruthy();
	});

	test("body null rechazado", () => {
		const r = validateCreateResource(null);
		expect(r.valid).toBe(false);
	});

	test("subjects no array rechazado", () => {
		const r = validateCreateResource({ ...validPayload, subjects: "no-array" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "subjects")).toBeTruthy();
	});

	test("múltiples errores acumulados", () => {
		const r = validateCreateResource({});
		expect(r.valid).toBe(false);
		expect(r.errors.length).toBeGreaterThanOrEqual(5);
	});
});

describe("validateUpdateResource", () => {
	test("update parcial válido pasa", () => {
		const r = validateUpdateResource({ title: "Nuevo título" });
		expect(r.valid).toBe(true);
	});

	test("update vacío falla", () => {
		const r = validateUpdateResource({});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "body")).toBeTruthy();
	});

	test("title vacío en update falla", () => {
		const r = validateUpdateResource({ title: "" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "title")).toBeTruthy();
	});

	test("title excede 500 caracteres en update falla", () => {
		const r = validateUpdateResource({ title: "x".repeat(501) });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "title")?.message).toContain("500");
	});

	test("description vacía en update falla", () => {
		const r = validateUpdateResource({ description: "" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "description")).toBeTruthy();
	});

	test("description excede 5000 en update falla", () => {
		const r = validateUpdateResource({ description: "x".repeat(5001) });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "description")?.message).toContain(
			"5000",
		);
	});

	test("language inválido en update falla", () => {
		const r = validateUpdateResource({ language: "zz" });
		expect(r.valid).toBe(false);
	});

	test("language vacío en update falla", () => {
		const r = validateUpdateResource({ language: "" });
		expect(r.valid).toBe(false);
	});

	test("license inválida en update falla", () => {
		const r = validateUpdateResource({ license: "mit" });
		expect(r.valid).toBe(false);
	});

	test("license vacía en update falla", () => {
		const r = validateUpdateResource({ license: "" });
		expect(r.valid).toBe(false);
	});

	test("resourceType vacío en update falla", () => {
		const r = validateUpdateResource({ resourceType: "" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "resourceType")).toBeTruthy();
	});

	test("author vacío o solo espacios se rechaza al actualizar", () => {
		for (const author of ["", "   "]) {
			const r = validateUpdateResource({ author });
			expect(r.valid).toBe(false);
			expect(r.errors.find((e) => e.field === "author")?.message).toBe(
				"El autor no puede estar vacío",
			);
		}
	});

	test("actualizar otros campos sin enviar author sigue siendo válido", () => {
		const r = validateUpdateResource({ title: "Nuevo título" });
		expect(r.valid).toBe(true);
	});

	test("body null falla", () => {
		const r = validateUpdateResource(null);
		expect(r.valid).toBe(false);
	});

	test("update con múltiples campos válidos pasa", () => {
		const r = validateUpdateResource({
			title: "T",
			description: "D",
			language: "es",
			license: "cc-by",
		});
		expect(r.valid).toBe(true);
	});
});

describe("validateStatus", () => {
	test("draft es válido", () => {
		expect(validateStatus("draft").valid).toBe(true);
	});

	test("review es válido", () => {
		expect(validateStatus("review").valid).toBe(true);
	});

	test("published es válido", () => {
		expect(validateStatus("published").valid).toBe(true);
	});

	test("archived es válido", () => {
		expect(validateStatus("archived").valid).toBe(true);
	});

	test("borrador rechazado (valor legacy)", () => {
		expect(validateStatus("borrador").valid).toBe(false);
	});

	test("vacío rechazado", () => {
		expect(validateStatus("").valid).toBe(false);
	});

	test("null rechazado", () => {
		expect(validateStatus(null).valid).toBe(false);
	});
});

describe("validateCreateResource — campos opcionales", () => {
	test("author no string rechazado", () => {
		const r = validateCreateResource({ ...validPayload, author: 123 });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "author")).toBeTruthy();
	});

	test("author excede 500 caracteres rechazado", () => {
		const r = validateCreateResource({
			...validPayload,
			author: "x".repeat(501),
		});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "author")?.message).toContain(
			"500",
		);
	});

	test("keywords no string rechazado", () => {
		const r = validateCreateResource({ ...validPayload, keywords: 42 });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "keywords")).toBeTruthy();
	});

	test("keywords excede 1000 caracteres rechazado", () => {
		const r = validateCreateResource({
			...validPayload,
			keywords: "x".repeat(1001),
		});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "keywords")?.message).toContain(
			"1000",
		);
	});

	test("publisher no string rechazado", () => {
		const r = validateCreateResource({ ...validPayload, publisher: true });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "publisher")).toBeTruthy();
	});

	test("levels no array rechazado", () => {
		const r = validateCreateResource({ ...validPayload, levels: "primaria" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "levels")).toBeTruthy();
	});
});

describe("validateCollection", () => {
	test("colección válida pasa", () => {
		const r = validateCollection({
			title: "Mi colección",
			description: "Desc",
		});
		expect(r.valid).toBe(true);
	});

	test("body null falla", () => {
		const r = validateCollection(null);
		expect(r.valid).toBe(false);
	});

	test("falta título falla", () => {
		const r = validateCollection({ description: "Desc" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "title")).toBeTruthy();
	});

	test("falta descripción falla", () => {
		const r = validateCollection({ title: "Col" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "description")).toBeTruthy();
	});

	test("título vacío falla", () => {
		const r = validateCollection({ title: "", description: "D" });
		expect(r.valid).toBe(false);
	});

	// #486: el estado editorial solo admite los mismos valores que los recursos.
	test("acepta los estados editoriales válidos", () => {
		for (const editorialStatus of [
			"draft",
			"review",
			"published",
			"archived",
		]) {
			const r = validateCollection({
				title: "Col",
				description: "D",
				editorialStatus,
			});
			expect(r.valid).toBe(true);
		}
	});

	test("sin estado editorial pasa (se usa el de por defecto)", () => {
		const r = validateCollection({ title: "Col", description: "D" });
		expect(r.valid).toBe(true);
	});

	test("rechaza un estado editorial inventado", () => {
		for (const editorialStatus of ["publicado", "foo", "", "PUBLISHED"]) {
			const r = validateCollection({
				title: "Col",
				description: "D",
				editorialStatus,
			});
			expect(r.valid).toBe(false);
			expect(r.errors.find((e) => e.field === "editorialStatus")).toBeTruthy();
		}
	});

	test("rechaza un estado editorial que no es texto", () => {
		for (const editorialStatus of [null, 1, true, ["published"]]) {
			const r = validateCollection({
				title: "Col",
				description: "D",
				editorialStatus,
			});
			expect(r.valid).toBe(false);
			expect(r.errors.find((e) => e.field === "editorialStatus")).toBeTruthy();
		}
	});
});

describe("validateTaxonomy", () => {
	test("taxonomía válida pasa", () => {
		const r = validateTaxonomy({ name: "Matemáticas", type: "subject" });
		expect(r.valid).toBe(true);
	});

	test("body null falla", () => {
		const r = validateTaxonomy(null);
		expect(r.valid).toBe(false);
	});

	test("falta nombre falla", () => {
		const r = validateTaxonomy({ type: "subject" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "name")).toBeTruthy();
	});

	test("tipo inválido falla", () => {
		const r = validateTaxonomy({ name: "Mat", type: "invalid-type" });
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "type")).toBeTruthy();
	});

	test("sin tipo pasa (es opcional)", () => {
		const r = validateTaxonomy({ name: "Mat" });
		expect(r.valid).toBe(true);
	});

	test("parentId UUID válido pasa", () => {
		const r = validateTaxonomy({
			name: "Mat",
			type: "subject",
			parentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		});
		expect(r.valid).toBe(true);
	});

	test("parentId null pasa (sin padre)", () => {
		const r = validateTaxonomy({
			name: "Mat",
			type: "subject",
			parentId: null,
		});
		expect(r.valid).toBe(true);
	});

	test("parentId cadena vacía pasa (sin padre)", () => {
		const r = validateTaxonomy({ name: "Mat", type: "subject", parentId: "" });
		expect(r.valid).toBe(true);
	});

	test("parentId no UUID falla", () => {
		const r = validateTaxonomy({
			name: "Mat",
			type: "subject",
			parentId: "no-es-un-uuid",
		});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "parentId")).toBeTruthy();
	});

	test("parentId con slug falla", () => {
		const r = validateTaxonomy({
			name: "Mat",
			type: "subject",
			parentId: "matematicas-basicas",
		});
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "parentId")).toBeTruthy();
	});
});

describe("validateStatusTransition", () => {
	test("draft → review permitida para author", () => {
		const r = validateTransition("draft", "review", "author");
		expect(r.valid).toBe(true);
	});

	test("review → published permitida para curator", () => {
		const r = validateTransition("review", "published", "curator");
		expect(r.valid).toBe(true);
	});

	test("transición inválida falla", () => {
		const r = validateTransition("published", "draft", "author");
		expect(r.valid).toBe(false);
	});

	test("rol insuficiente falla", () => {
		const r = validateTransition("review", "published", "author");
		expect(r.valid).toBe(false);
		expect(r.errors.find((e) => e.field === "status")?.message).toContain(
			"Rol insuficiente",
		);
	});
});

// Issue #408: al pasar a revisión o publicar se exige el recurso completo.
describe("validateResourceForStatus", () => {
	const stored = {
		...validPayload,
		keywords: null,
		publisher: null,
		// #448: también hace falta un área (se prueba en su propio bloque).
		knowledgeAreas: [{ id: "quimica" }],
	};

	test("review y published exigen los campos obligatorios del alta", () => {
		const incomplete = { ...stored, description: " ", author: null };
		for (const status of ["review", "published"]) {
			const result = validateResourceForStatus(incomplete, status);
			expect(result.valid).toBe(false);
			expect(result.errors.map((e) => e.field).sort()).toEqual([
				"author",
				"description",
			]);
		}
	});

	test("un recurso completo puede ir a revisión y publicarse", () => {
		expect(validateResourceForStatus(stored, "review").valid).toBe(true);
		expect(validateResourceForStatus(stored, "published").valid).toBe(true);
	});

	test("draft y archived no exigen nada", () => {
		const empty = { title: "", description: "", resourceType: null };
		expect(validateResourceForStatus(empty, "draft").valid).toBe(true);
		expect(validateResourceForStatus(empty, "archived").valid).toBe(true);
	});
});

describe("otherAuthors (issue #417)", () => {
	test("es opcional al crear: sin el campo o vacío sigue siendo válido", () => {
		expect(validateCreateResource(validPayload).valid).toBe(true);
		expect(
			validateCreateResource({ ...validPayload, otherAuthors: "" }).valid,
		).toBe(true);
		expect(
			validateCreateResource({
				...validPayload,
				otherAuthors: "Ana Pérez, Luis Gómez",
			}).valid,
		).toBe(true);
	});

	test("rechaza un valor que no es texto o que supera 1000 caracteres", () => {
		const notText = validateCreateResource({
			...validPayload,
			otherAuthors: 1,
		});
		expect(
			notText.errors.find((e) => e.field === "otherAuthors")?.message,
		).toBe("Los otros autores deben ser texto");
		const tooLong = validateCreateResource({
			...validPayload,
			otherAuthors: "x".repeat(1001),
		});
		expect(
			tooLong.errors.find((e) => e.field === "otherAuthors")?.message,
		).toBe("Los otros autores no pueden superar 1000 caracteres");
	});

	test("se puede actualizar solo, y vaciar para borrarlo", () => {
		expect(validateUpdateResource({ otherAuthors: "Ana Pérez" }).valid).toBe(
			true,
		);
		expect(validateUpdateResource({ otherAuthors: "" }).valid).toBe(true);
		expect(
			validateUpdateResource({ otherAuthors: "x".repeat(1001) }).valid,
		).toBe(false);
	});
});

// Issue #448: áreas de conocimiento y familias profesionales en el recurso.
describe("áreas de conocimiento y familias profesionales (#448)", () => {
	const fp = [{ categoryId: "formacion-profesional", optionId: null }];

	test("el alta admite hasta 3 áreas sin repetir", () => {
		expect(
			validateCreateResource({
				...validPayload,
				knowledgeAreaIds: ["quimica", "fisica", "ingles"],
			}).valid,
		).toBe(true);
		const tooMany = validateCreateResource({
			...validPayload,
			knowledgeAreaIds: ["quimica", "fisica", "ingles", "musica"],
		});
		expect(tooMany.errors).toEqual([
			{ field: KNOWLEDGE_AREA_FIELD, message: KNOWLEDGE_AREA_MESSAGES.max },
		]);
		expect(
			validateCreateResource({
				...validPayload,
				knowledgeAreaIds: ["quimica", "quimica"],
			}).errors[0]?.message,
		).toBe(KNOWLEDGE_AREA_MESSAGES.duplicateSelection);
		expect(
			validateCreateResource({ ...validPayload, knowledgeAreaIds: "quimica" })
				.errors[0]?.field,
		).toBe(KNOWLEDGE_AREA_FIELD);
	});

	test("guardar un borrador sin áreas es válido", () => {
		expect(
			validateCreateResource({ ...validPayload, knowledgeAreaIds: [] }).valid,
		).toBe(true);
	});

	test("las familias son de la lista oficial y solo con FP", () => {
		expect(
			validateCreateResource({
				...validPayload,
				educationalAreas: fp,
				professionalFamilyIds: ["hosteleria-y-turismo"],
			}).valid,
		).toBe(true);
		expect(
			validateCreateResource({
				...validPayload,
				educationalAreas: fp,
				professionalFamilyIds: ["inventada"],
			}).errors,
		).toEqual([
			{
				field: PROFESSIONAL_FAMILY_FIELD,
				message: KNOWLEDGE_AREA_MESSAGES.unknownFamily,
			},
		]);
		expect(
			validateCreateResource({
				...validPayload,
				educationalAreas: [
					{ categoryId: "educacion-primaria", optionId: null },
				],
				professionalFamilyIds: ["sanidad"],
			}).errors[0]?.message,
		).toBe(KNOWLEDGE_AREA_MESSAGES.familyRequiresFp);
		expect(
			validateCreateResource({
				...validPayload,
				professionalFamilyIds: ["sanidad"],
			}).errors[0]?.message,
		).toBe(KNOWLEDGE_AREA_MESSAGES.familyRequiresFp);
	});

	test("la edición acepta solo áreas o solo familias", () => {
		expect(
			validateUpdateResource({ knowledgeAreaIds: ["quimica"] }).valid,
		).toBe(true);
		expect(validateUpdateResource({ knowledgeAreaIds: [] }).valid).toBe(true);
		// Sin categorización en el cuerpo, la de FP la comprueba el repositorio.
		expect(
			validateUpdateResource({ professionalFamilyIds: ["sanidad"] }).valid,
		).toBe(true);
		expect(
			validateUpdateResource({ knowledgeAreaIds: ["a", "b", "c", "d"] })
				.errors[0]?.field,
		).toBe(KNOWLEDGE_AREA_FIELD);
		expect(
			validateUpdateResource({
				educationalAreas: [],
				professionalFamilyIds: ["sanidad"],
			}).errors[0]?.message,
		).toBe(KNOWLEDGE_AREA_MESSAGES.familyRequiresFp);
		expect(
			validateUpdateResource({ professionalFamilyIds: ["inventada"] }).errors[0]
				?.message,
		).toBe(KNOWLEDGE_AREA_MESSAGES.unknownFamily);
	});

	test("enviar a revisión o publicar exige al menos un área", () => {
		const stored = { ...validPayload, keywords: null, publisher: null };
		for (const status of ["review", "published"]) {
			for (const knowledgeAreas of [undefined, []]) {
				const result = validateResourceForStatus(
					{ ...stored, knowledgeAreas },
					status,
				);
				expect(result.errors).toEqual([
					{
						field: KNOWLEDGE_AREA_FIELD,
						message: KNOWLEDGE_AREA_MESSAGES.required,
					},
				]);
			}
			expect(
				validateResourceForStatus(
					{ ...stored, knowledgeAreas: [{ id: "quimica" }] },
					status,
				).valid,
			).toBe(true);
		}
		expect(validateResourceForStatus(stored, "draft").valid).toBe(true);
		expect(validateResourceForStatus(stored, "archived").valid).toBe(true);
	});

	test("un recurso publicado con áreas no puede quedarse sin ninguna", () => {
		const published = {
			editorialStatus: "published",
			knowledgeAreas: [{ id: "quimica" }],
		};
		expect(
			validateResourceUpdateForStatus(published, { knowledgeAreaIds: [] })
				.errors,
		).toEqual([
			{
				field: KNOWLEDGE_AREA_FIELD,
				message: KNOWLEDGE_AREA_MESSAGES.requiredWhilePublished,
			},
		]);
		expect(
			validateResourceUpdateForStatus(
				{ ...published, editorialStatus: "review" },
				{ knowledgeAreaIds: [] },
			).valid,
		).toBe(false);
		expect(
			validateResourceUpdateForStatus(published, {
				knowledgeAreaIds: ["fisica"],
			}).valid,
		).toBe(true);
		expect(
			validateResourceUpdateForStatus(published, { title: "Otro" }).valid,
		).toBe(true);
		// Un borrador sí puede vaciarlas, y un importado sin áreas se sigue
		// editando sin elegirlas (su clasificación llega con el PR 3).
		expect(
			validateResourceUpdateForStatus(
				{ ...published, editorialStatus: "draft" },
				{ knowledgeAreaIds: [] },
			).valid,
		).toBe(true);
		expect(
			validateResourceUpdateForStatus(
				{ editorialStatus: "published", knowledgeAreas: [] },
				{ knowledgeAreaIds: [] },
			).valid,
		).toBe(true);
	});
});
