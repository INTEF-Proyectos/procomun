import { describe, expect, test } from "bun:test";
import {
	canTransition,
	ROLE_LEVELS,
	TRANSITION_RULES,
	transitionExclusionError,
	validateTransition,
} from "@procomun/db/validation";

describe("validateTransition", () => {
	describe("author puede enviar a revisión", () => {
		test("draft → review con author es válido", () => {
			const r = validateTransition("draft", "review", "author");
			expect(r.valid).toBe(true);
		});

		test("draft → review con curator es válido", () => {
			const r = validateTransition("draft", "review", "curator");
			expect(r.valid).toBe(true);
		});

		test("draft → review con admin es válido", () => {
			const r = validateTransition("draft", "review", "admin");
			expect(r.valid).toBe(true);
		});
	});

	describe("author no puede saltar pasos ni aprobar", () => {
		test("draft → published con author es inválido (rol insuficiente)", () => {
			const r = validateTransition("draft", "published", "author");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError).toBeDefined();
			expect(firstError?.message).toContain("Rol insuficiente");
		});

		test("review → published con author es inválido (rol insuficiente)", () => {
			const r = validateTransition("review", "published", "author");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError).toBeDefined();
			expect(firstError?.message).toContain("Rol insuficiente");
		});

		test("review → draft con author es inválido (rol insuficiente)", () => {
			const r = validateTransition("review", "draft", "author");
			expect(r.valid).toBe(false);
		});
	});

	describe("editor puede publicar directamente sus borradores", () => {
		test("draft → published con editor es válido", () => {
			const r = validateTransition("draft", "published", "editor");
			expect(r.valid).toBe(true);
		});

		// #506: el editor publica directamente; no envía a revisión.
		test("draft → review con editor es inválido", () => {
			const r = validateTransition("draft", "review", "editor");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError?.field).toBe("status");
			expect(firstError?.message).toContain("editor");
		});

		test("review → published con editor es inválido (rol insuficiente)", () => {
			const r = validateTransition("review", "published", "editor");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError).toBeDefined();
			expect(firstError?.message).toContain("Rol insuficiente");
		});

		test("review → draft con editor es inválido (rol insuficiente)", () => {
			const r = validateTransition("review", "draft", "editor");
			expect(r.valid).toBe(false);
		});

		test("published → archived con editor es inválido (rol insuficiente)", () => {
			const r = validateTransition("published", "archived", "editor");
			expect(r.valid).toBe(false);
		});
	});

	describe("curator puede gestionar flujo completo", () => {
		test("review → published con curator es válido", () => {
			const r = validateTransition("review", "published", "curator");
			expect(r.valid).toBe(true);
		});

		test("review → draft con curator es válido (rechazo)", () => {
			const r = validateTransition("review", "draft", "curator");
			expect(r.valid).toBe(true);
		});

		test("published → archived con curator es válido", () => {
			const r = validateTransition("published", "archived", "curator");
			expect(r.valid).toBe(true);
		});

		test("archived → draft con curator es válido (restaurar)", () => {
			const r = validateTransition("archived", "draft", "curator");
			expect(r.valid).toBe(true);
		});
	});

	describe("admin hereda permisos de curator", () => {
		test("review → published con admin es válido", () => {
			const r = validateTransition("review", "published", "admin");
			expect(r.valid).toBe(true);
		});

		test("published → archived con admin es válido", () => {
			const r = validateTransition("published", "archived", "admin");
			expect(r.valid).toBe(true);
		});
	});

	describe("reader no puede hacer transiciones", () => {
		test("draft → review con reader es inválido", () => {
			const r = validateTransition("draft", "review", "reader");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError).toBeDefined();
			expect(firstError?.message).toContain("Rol insuficiente");
		});
	});

	describe("transiciones inválidas", () => {
		test("published → review no está permitida", () => {
			const r = validateTransition("published", "review", "admin");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError).toBeDefined();
			expect(firstError?.message).toContain("Transición no permitida");
		});

		test("draft → archived no está permitida", () => {
			const r = validateTransition("draft", "archived", "admin");
			expect(r.valid).toBe(false);
		});

		test("estado actual desconocido retorna error", () => {
			const r = validateTransition("unknown", "draft", "admin");
			expect(r.valid).toBe(false);
			const firstError = r.errors[0];
			expect(firstError).toBeDefined();
			expect(firstError?.message).toContain("Estado actual no válido");
		});
	});
});

describe("transiciones por rol (#506)", () => {
	const statuses = ["draft", "review", "published", "archived"] as const;
	// Lo que cada rol puede hacer. Solo cambia el editor: pierde draft → review.
	const allowed: Record<string, string[]> = {
		reader: [],
		author: ["draft→review"],
		editor: ["draft→published"],
		curator: [
			"draft→review",
			"draft→published",
			"review→draft",
			"review→published",
			"published→archived",
			"archived→draft",
		],
		admin: [
			"draft→review",
			"draft→published",
			"review→draft",
			"review→published",
			"published→archived",
			"archived→draft",
		],
	};

	for (const [role, transitions] of Object.entries(allowed)) {
		test(`${role}: ${transitions.join(", ") || "ninguna"}`, () => {
			const valid: string[] = [];
			for (const from of statuses) {
				for (const to of statuses) {
					if (validateTransition(from, to, role).valid) {
						valid.push(`${from}→${to}`);
					}
				}
			}
			expect(valid).toEqual(transitions);
		});
	}

	test("canTransition coincide con validateTransition", () => {
		for (const role of Object.keys(allowed)) {
			for (const from of statuses) {
				for (const to of statuses) {
					expect(canTransition(from, to, role)).toBe(
						validateTransition(from, to, role).valid,
					);
				}
			}
		}
	});

	test("canTransition con un rol desconocido no permite nada", () => {
		expect(canTransition("draft", "review", "desconocido")).toBe(false);
	});

	test("transitionExclusionError solo señala al editor en draft → review", () => {
		expect(transitionExclusionError("draft", "review", "editor")).toEqual({
			field: "status",
			message: "El rol editor no puede hacer esta transición: draft → review",
		});
		for (const role of ["reader", "author", "curator", "admin"]) {
			expect(transitionExclusionError("draft", "review", role)).toBeNull();
		}
		expect(transitionExclusionError("draft", "published", "editor")).toBeNull();
		expect(
			transitionExclusionError("estado-raro", "review", "editor"),
		).toBeNull();
	});
});

describe("TRANSITION_RULES", () => {
	test("cubre todos los estados válidos excepto terminales sin salida", () => {
		expect(Object.keys(TRANSITION_RULES)).toContain("draft");
		expect(Object.keys(TRANSITION_RULES)).toContain("review");
		expect(Object.keys(TRANSITION_RULES)).toContain("published");
		expect(Object.keys(TRANSITION_RULES)).toContain("archived");
	});
});

describe("ROLE_LEVELS", () => {
	test("jerarquía de roles es correcta", () => {
		const reader = ROLE_LEVELS.reader;
		const author = ROLE_LEVELS.author;
		const editor = ROLE_LEVELS.editor;
		const curator = ROLE_LEVELS.curator;
		const admin = ROLE_LEVELS.admin;
		expect(reader).toBeDefined();
		expect(author).toBeDefined();
		expect(editor).toBeDefined();
		expect(curator).toBeDefined();
		expect(admin).toBeDefined();
		if (
			reader === undefined ||
			author === undefined ||
			editor === undefined ||
			curator === undefined ||
			admin === undefined
		) {
			throw new Error("ROLE_LEVELS incompleto");
		}
		expect(reader).toBeLessThan(author);
		expect(author).toBeLessThan(editor);
		expect(editor).toBeLessThan(curator);
		expect(curator).toBeLessThan(admin);
	});
});
