import { describe, expect, test } from "bun:test";
import { getViewSessionId, trackViewOnce } from "./view-tracking.ts";

function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key) => data.get(key) ?? null,
		key: (index) => [...data.keys()][index] ?? null,
		removeItem: (key) => {
			data.delete(key);
		},
		setItem: (key, value) => {
			data.set(key, value);
		},
	};
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("view-tracking (#421)", () => {
	test("crea un identificador aleatorio por sesión y lo reutiliza", () => {
		const storage = memoryStorage();
		const first = getViewSessionId(storage);
		expect(first).toMatch(UUID_RE);
		expect(getViewSessionId(storage)).toBe(first);
		expect(getViewSessionId(memoryStorage())).not.toBe(first);
	});

	test("llama a la API una sola vez por recurso en la misma sesión", async () => {
		const storage = memoryStorage();
		const calls: Array<[string, string]> = [];
		const track = async (slug: string, sessionId: string) => {
			calls.push([slug, sessionId]);
			return { viewCount: calls.length };
		};

		expect(await trackViewOnce("a", track, storage)).toBe(1);
		expect(await trackViewOnce("a", track, storage)).toBeNull();
		expect(await trackViewOnce("b", track, storage)).toBe(2);
		expect(calls.map(([slug]) => slug)).toEqual(["a", "b"]);
		expect(new Set(calls.map(([, id]) => id)).size).toBe(1);
	});

	test("si la API falla, se puede volver a intentar", async () => {
		const storage = memoryStorage();
		let fail = true;
		const track = async () => {
			if (fail) throw new Error("offline");
			return { viewCount: 7 };
		};

		expect(await trackViewOnce("a", track, storage)).toBeNull();
		fail = false;
		expect(await trackViewOnce("a", track, storage)).toBe(7);
	});

	test("sin almacenamiento disponible no cuenta", async () => {
		let called = false;
		const track = async () => {
			called = true;
			return { viewCount: 1 };
		};
		expect(await trackViewOnce("a", track, null)).toBeNull();
		expect(called).toBe(false);
	});
});
