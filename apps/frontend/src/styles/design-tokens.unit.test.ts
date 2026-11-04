import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * #529: axe tumbaba `wcag.e2e.ts` en la portada y en el login por contraste
 * insuficiente. La causa no eran tres puntos sueltos: `--color-outline`, que
 * 34 reglas usan como color de texto, estaba en 4,28:1 sobre la portada y en
 * 4,08:1 sobre la caja del login, por debajo del 4,5:1 que pide WCAG 2.1 AA
 * para texto normal.
 *
 * Este test fija el suelo. Es barato y falla en `bun test`, mucho antes que el
 * e2e, si alguien vuelve a aclarar el token o el fondo.
 */

const TOKENS = readFileSync(join(import.meta.dir, "design-tokens.css"), "utf8");

/** Valor de una custom property del bloque de tokens. */
export function tokenValue(name: string): string {
	const match = TOKENS.match(
		new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`),
	);
	if (!match?.[1])
		throw new Error(`No se encontro --${name} en design-tokens.css`);
	return match[1].toLowerCase();
}

/** Luminancia relativa de WCAG 2.1 (sRGB). */
function relativeLuminance(hex: string): number {
	const channel = (value: number) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const n = Number.parseInt(hex.slice(1), 16);
	return (
		0.2126 * channel((n >> 16) & 0xff) +
		0.7152 * channel((n >> 8) & 0xff) +
		0.0722 * channel(n & 0xff)
	);
}

/** Relacion de contraste de WCAG 2.1 entre dos colores opacos. */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

describe("contrastRatio", () => {
	test("reproduce los valores de referencia de WCAG", () => {
		// Negro sobre blanco es el maximo: 21:1.
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
		// Un color consigo mismo, el minimo: 1:1.
		expect(contrastRatio("#6c6f7f", "#6c6f7f")).toBeCloseTo(1, 5);
		// Simetrico: da igual cual es texto y cual fondo.
		expect(contrastRatio("#6c6f7f", "#ffffff")).toBeCloseTo(
			contrastRatio("#ffffff", "#6c6f7f"),
			5,
		);
	});
});

describe("contraste de los tokens de texto (#529)", () => {
	// Fondos claros sobre los que se pinta texto con estos tokens.
	const BACKGROUNDS = [
		["blanco", "#ffffff"],
		["surface-bright (portada)", tokenValue("color-surface-bright")],
		[
			"surface-container-low (caja del login)",
			tokenValue("color-surface-container-low"),
		],
	] as const;

	// Tokens que se usan como color de texto normal: 4,5:1 (WCAG 2.1 AA).
	const TEXT_TOKENS = [
		"color-outline",
		"color-on-surface",
		"color-on-surface-variant",
	];

	for (const token of TEXT_TOKENS) {
		for (const [name, background] of BACKGROUNDS) {
			test(`--${token} sobre ${name} cumple 4,5:1`, () => {
				const ratio = contrastRatio(tokenValue(token), background);
				expect(ratio).toBeGreaterThanOrEqual(4.5);
			});
		}
	}

	test("--color-outline sigue siendo el tono que se eligio en #529", () => {
		// Si se cambia a proposito, actualiza aqui y comprueba la portada y el
		// login con axe: 34 reglas lo usan como color de texto.
		expect(tokenValue("color-outline")).toBe("#6c6f7f");
	});

	test("--color-outline-variant solo vale para bordes: 3:1 y no se usa en texto", () => {
		const ratio = contrastRatio(tokenValue("color-outline-variant"), "#ffffff");
		expect(ratio).toBeLessThan(4.5);
	});
});
