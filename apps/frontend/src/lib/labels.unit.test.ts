import { describe, expect, test } from "bun:test";

import { labelFor } from "./labels.ts";

const LABELS: Record<string, string> = {
	draft: "Borrador",
	published: "Publicado",
};

describe("labelFor (#576)", () => {
	test("devuelve la etiqueta de una clave propia", () => {
		expect(labelFor(LABELS, "draft")).toBe("Borrador");
		expect(labelFor(LABELS, "published", "otro")).toBe("Publicado");
	});

	test("una clave desconocida da el respaldo, o undefined sin él", () => {
		expect(labelFor(LABELS, "archived", "archived")).toBe("archived");
		expect(labelFor(LABELS, "archived")).toBeUndefined();
	});

	test.each([
		"__proto__",
		"constructor",
		"toString",
		"hasOwnProperty",
		"valueOf",
	])("la clave heredada %s no devuelve la propiedad del prototipo", (key) => {
		expect(labelFor(LABELS, key, key)).toBe(key);
		expect(labelFor(LABELS, key)).toBeUndefined();
	});

	test("sin clave devuelve el respaldo", () => {
		expect(labelFor(LABELS, null, "-")).toBe("-");
		expect(labelFor(LABELS, undefined)).toBeUndefined();
	});

	test("sirve con valores que no son texto", () => {
		const STATUS = { draft: { label: "Borrador", cssClass: "x" } };
		expect(labelFor(STATUS, "draft")?.label).toBe("Borrador");
		expect(labelFor(STATUS, "constructor")).toBeUndefined();
	});
});
