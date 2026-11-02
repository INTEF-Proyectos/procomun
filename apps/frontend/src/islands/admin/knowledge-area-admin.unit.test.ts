import { describe, expect, test } from "bun:test";
import type { KnowledgeAreaRecord } from "../../lib/api-client.ts";
import {
	filterKnowledgeAreas,
	knowledgeAreaErrorMessage,
} from "./knowledge-area-admin.ts";

function area(
	id: string,
	label: string,
	blockId: string,
	active = true,
): KnowledgeAreaRecord {
	return {
		id,
		label,
		description: null,
		blockId,
		position: 0,
		active,
		usageCount: 0,
	};
}

const areas = [
	area("quimica", "Química", "ciencias"),
	area("fisica", "Física", "ciencias", false),
	area("historia", "Historia", "humanidades"),
];

describe("filtro del panel de áreas (#448)", () => {
	test("busca sin mayúsculas ni tildes", () => {
		expect(
			filterKnowledgeAreas(areas, {
				q: "QUIMI",
				blockId: "",
				status: "all",
			}).map((item) => item.id),
		).toEqual(["quimica"]);
	});

	test("filtra por bloque y por estado", () => {
		expect(
			filterKnowledgeAreas(areas, {
				q: "",
				blockId: "ciencias",
				status: "inactive",
			}).map((item) => item.id),
		).toEqual(["fisica"]);
		expect(
			filterKnowledgeAreas(areas, { q: "", blockId: "", status: "active" }).map(
				(item) => item.id,
			),
		).toEqual(["quimica", "historia"]);
	});

	test("usa el mensaje del servidor si lo hay", () => {
		expect(knowledgeAreaErrorMessage({ error: "Duplicada" }, "Error")).toBe(
			"Duplicada",
		);
		expect(knowledgeAreaErrorMessage(new Error("x"), "Error")).toBe("Error");
	});
});
