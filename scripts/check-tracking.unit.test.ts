import { describe, expect, test } from "bun:test";
import {
	findDanglingRefs,
	findDuplicateAdrKeys,
	findDuplicateTaskKeys,
	findMissingAdrFiles,
} from "./check-tracking.ts";

describe("check-tracking: claves duplicadas", () => {
	test("detecta una clave de tarea repetida y dice en qué líneas", () => {
		const raw = [
			"tasks:",
			"  T-2026-07-17-001:",
			"    task: primera",
			"  T-2026-07-17-002:",
			"    task: la de main",
			"  T-2026-07-17-002:",
			"    task: la de otra rama",
		].join("\n");

		const dups = findDuplicateTaskKeys(raw);
		expect(dups).toHaveLength(1);
		expect(dups[0]?.key).toBe("T-2026-07-17-002");
		expect(dups[0]?.lines).toEqual([4, 6]);
	});

	test("no marca nada cuando todas las claves son únicas", () => {
		const raw = [
			"tasks:",
			"  T-2026-07-17-001:",
			"  T-2026-07-17-002:",
			"  T-2026-07-17-003:",
		].join("\n");
		expect(findDuplicateTaskKeys(raw)).toHaveLength(0);
	});

	/**
	 * La razón de ser del script: sobre el objeto parseado el duplicado es
	 * invisible porque el parser ya se ha quedado con el último. Este test fija
	 * ese comportamiento para que nadie "simplifique" el script a parsear y
	 * mirar las claves.
	 */
	test("el parser YAML se come el duplicado, por eso se mira el texto crudo", () => {
		const raw = [
			"tasks:",
			"  T-2026-07-17-002:",
			"    task: la de main",
			"  T-2026-07-17-002:",
			"    task: la de otra rama",
		].join("\n");

		const parsed = Bun.YAML.parse(raw) as {
			tasks: Record<string, { task: string }>;
		};
		// El parser no falla y solo deja una: la entrada de main se ha perdido.
		expect(Object.keys(parsed.tasks)).toHaveLength(1);
		expect(parsed.tasks["T-2026-07-17-002"]?.task).toBe("la de otra rama");
		// Sobre el texto crudo sí se ve.
		expect(findDuplicateTaskKeys(raw)).toHaveLength(1);
	});

	test("detecta ADR duplicadas, incluidos los sufijos tipo 0015a", () => {
		const raw = [
			"ADR-0015a:",
			"  title: uno",
			"ADR-0015b:",
			"  title: dos",
			"ADR-0029:",
			"  title: importador",
			"ADR-0029:",
			"  title: otra cosa",
		].join("\n");

		const dups = findDuplicateAdrKeys(raw);
		expect(dups).toHaveLength(1);
		expect(dups[0]?.key).toBe("ADR-0029");
	});

	test("ignora claves indentadas o de otro tipo", () => {
		const raw = [
			"metadata:",
			"  updated: 2026-07-17",
			"tasks:",
			"  status: x",
		].join("\n");
		expect(findDuplicateTaskKeys(raw)).toHaveLength(0);
		expect(findDuplicateAdrKeys(raw)).toHaveLength(0);
	});
});

describe("check-tracking: ficheros de ADR", () => {
	test("marca una ADR cuyo fichero no existe", () => {
		const decisions = {
			"ADR-0029": { file: "0029-importador.md" },
			"ADR-0030": { file: "0030-no-existe.md" },
		};
		const missing = findMissingAdrFiles(
			decisions,
			(f) => f === "0029-importador.md",
		);
		expect(missing).toEqual([{ key: "ADR-0030", file: "0030-no-existe.md" }]);
	});

	test("marca una ADR sin campo file:", () => {
		const missing = findMissingAdrFiles({ "ADR-0031": {} }, () => true);
		expect(missing).toHaveLength(1);
		expect(missing[0]?.key).toBe("ADR-0031");
	});

	test("no marca nada cuando todos los ficheros existen", () => {
		const decisions = {
			"ADR-0029": { file: "a.md" },
			"ADR-0030": { file: "b.md" },
		};
		expect(findMissingAdrFiles(decisions, () => true)).toHaveLength(0);
	});
});

describe("check-tracking: referencias colgantes", () => {
	const adrKeys = new Set(["ADR-0029", "ADR-0030"]);

	test("detecta una tarea y una ADR inexistentes", () => {
		const tasks = {
			"T-2026-07-17-001": { related: ["T-2026-07-16-999", "ADR-0099"] },
		};
		const dangling = findDanglingRefs(
			tasks,
			new Set(Object.keys(tasks)),
			adrKeys,
		);
		expect(dangling).toEqual([
			{ from: "T-2026-07-17-001", ref: "T-2026-07-16-999" },
			{ from: "T-2026-07-17-001", ref: "ADR-0099" },
		]);
	});

	test("ignora referencias que no son claves de tarea ni de ADR", () => {
		const tasks = {
			"T-2026-07-17-001": {
				related: ["epic-004-migracion-legacy-procomun", "#236", "DEF-003"],
			},
		};
		expect(
			findDanglingRefs(tasks, new Set(Object.keys(tasks)), adrKeys),
		).toHaveLength(0);
	});

	test("acepta referencias que sí existen", () => {
		const tasks = {
			"T-2026-07-17-001": { related: ["ADR-0029"] },
			"T-2026-07-17-002": { related: ["T-2026-07-17-001"] },
		};
		expect(
			findDanglingRefs(tasks, new Set(Object.keys(tasks)), adrKeys),
		).toHaveLength(0);
	});

	test("tolera entradas sin related o con related no-lista", () => {
		const tasks = {
			"T-2026-07-17-001": {},
			"T-2026-07-17-002": { related: "ADR-0029" as unknown },
		};
		expect(
			findDanglingRefs(tasks, new Set(Object.keys(tasks)), adrKeys),
		).toHaveLength(0);
	});
});
