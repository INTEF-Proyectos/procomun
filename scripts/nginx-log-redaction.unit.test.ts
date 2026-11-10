import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	buildSignedElpxPreviewUrl,
	ELPX_PREVIEW_PREFIX,
} from "../apps/api/src/elpx/preview-token.ts";

/**
 * Algunas URL son el único permiso de acceso: el enlace firmado de un recurso
 * no publicado (#466, `/api/v1/elpx/preview/<hash>/<token>/…`), la instantánea
 * de la vista previa del editor (#317, `/api/v1/preview/<id>/…` y
 * `/api/v1/preview-session/<id>`) y el `?token=` de la verificación de correo
 * de Better Auth. El formato `main` de nginx:alpine guarda `$request` y
 * `$http_referer` enteros, así que quien lee el log puede abrirlas.
 *
 * No hay nginx en local ni en el CI de tests: aquí se lee `nginx.conf`, se
 * comprueba que el `access_log` usa un formato con las variables redactadas y
 * se ejecutan las regex de los `map` contra URL de ejemplo. Las regex de nginx
 * (PCRE) se pasan a RegExp de JS; los grupos con nombre `(?P<n>…)` y `(?'n'…)`
 * se reescriben como `(?<n>…)`.
 */

type Token = { value: string; quoted: boolean };
type Directive = { name: string; args: string[]; block?: Directive[] };

/** Palabras, cadenas entre comillas y `{ } ;`. Quita los comentarios. */
function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i] as string;
		if (/\s/.test(ch)) {
			i++;
		} else if (ch === "#") {
			while (i < text.length && text[i] !== "\n") i++;
		} else if (ch === "{" || ch === "}" || ch === ";") {
			tokens.push({ value: ch, quoted: false });
			i++;
		} else if (ch === '"' || ch === "'") {
			let value = "";
			i++;
			while (i < text.length && text[i] !== ch) {
				const next = text[i + 1];
				// Igual que ngx_conf_read_token: \" \' \\ se desescapan, \t \r \n
				// son control y cualquier otra barra (\. en una regex) se queda.
				if (text[i] === "\\" && next !== undefined && `"'\\`.includes(next)) {
					value += next;
					i += 2;
				} else if (
					text[i] === "\\" &&
					next !== undefined &&
					"trn".includes(next)
				) {
					value += { t: "\t", r: "\r", n: "\n" }[next];
					i += 2;
				} else {
					value += text[i];
					i++;
				}
			}
			i++;
			tokens.push({ value, quoted: true });
		} else {
			let word = "";
			while (i < text.length && !/[\s;{}]/.test(text[i] as string)) {
				// `${var}` dentro de una palabra sin comillas no abre bloque.
				if (text[i] === "$" && text[i + 1] === "{") {
					const end = text.indexOf("}", i);
					word += text.slice(i, end + 1);
					i = end + 1;
				} else {
					word += text[i];
					i++;
				}
			}
			tokens.push({ value: word, quoted: false });
		}
	}
	return tokens;
}

function parse(tokens: Token[]): Directive[] {
	let pos = 0;
	const isSymbol = (t: Token, s: string) => !t.quoted && t.value === s;
	function block(): Directive[] {
		const out: Directive[] = [];
		while (pos < tokens.length) {
			if (isSymbol(tokens[pos] as Token, "}")) {
				pos++;
				return out;
			}
			const words: string[] = [];
			while (pos < tokens.length) {
				const token = tokens[pos++] as Token;
				if (isSymbol(token, ";") || isSymbol(token, "{")) {
					const [name = "", ...args] = words;
					out.push(
						isSymbol(token, "{")
							? { name, args, block: block() }
							: { name, args },
					);
					break;
				}
				words.push(token.value);
			}
		}
		return out;
	}
	return block();
}

function walk(directives: Directive[]): Directive[] {
	return directives.flatMap((d) => [d, ...walk(d.block ?? [])]);
}

function toJsRegex(key: string): RegExp | null {
	if (!key.startsWith("~")) return null;
	const caseless = key.startsWith("~*");
	const source = key
		.slice(caseless ? 2 : 1)
		.replace(/\(\?P<(\w+)>/g, "(?<$1>")
		.replace(/\(\?'(\w+)'/g, "(?<$1>");
	return new RegExp(source, caseless ? "i" : "");
}

/** Sustituye `$name` y `${name}`; una variable que el test no conoce falla. */
function expand(value: string, vars: Record<string, string>): string {
	return value.replace(
		/\$(?:\{(\w+)\}|(\w+))/g,
		(_, braced: string | undefined, bare: string | undefined) => {
			const name = (braced ?? bare) as string;
			const resolved = vars[name];
			if (resolved === undefined) {
				throw new Error(`Variable $${name} sin valor en el test`);
			}
			return resolved;
		},
	);
}

const SPECIAL_MAP_KEYS = new Set([
	"default",
	"hostnames",
	"include",
	"volatile",
]);

/**
 * Evalúa un `map` con la prioridad de nginx que aplica aquí: cadena exacta,
 * después la primera regex que case en orden de aparición y, si no, `default`.
 */
function evalMap(
	map: Directive,
	input: string,
	extra: Record<string, string> = {},
): string {
	const source = (map.args[0] as string).replace(/^\$/, "");
	const entries = map.block ?? [];
	const base = { ...extra, [source]: input };
	const exact = entries.find(
		(e) =>
			!SPECIAL_MAP_KEYS.has(e.name) &&
			!e.name.startsWith("~") &&
			e.name === input,
	);
	if (exact) return expand(exact.args[0] as string, base);
	for (const entry of entries) {
		const regex = toJsRegex(entry.name);
		const match = regex?.exec(input);
		if (!match) continue;
		const vars: Record<string, string> = { ...base };
		match.forEach((v, i) => {
			vars[String(i)] = v ?? "";
		});
		for (const [k, v] of Object.entries(match.groups ?? {})) vars[k] = v ?? "";
		return expand(entry.args[0] as string, vars);
	}
	const fallback = entries.find((e) => e.name === "default");
	return fallback ? expand(fallback.args[0] as string, base) : "";
}

const conf = parse(
	tokenize(await Bun.file(join(import.meta.dir, "..", "nginx.conf")).text()),
);
const all = walk(conf);
const maps = all.filter((d) => d.name === "map");
const findMap = (from: string, to: string) =>
	maps.find((m) => m.args[0] === from && m.args[1] === to);
const rawPathMap = findMap("$request_uri", "$request_path_raw");
const queryMarkerMap = findMap("$is_args", "$query_marker");
const requestPathMap = findMap("$uri", "$request_path");
const pathMap = findMap("$request_path", "$redacted_path");
const refererPathMap = findMap("$http_referer", "$referer_path");
const refererRedactMap = findMap("$referer_path", "$redacted_referer");

/**
 * `$uri` de nginx para una petición a la API: la ruta sin query, con los %xx
 * decodificados y las barras repetidas unidas. Fuera de `/api/` el try_files
 * del SPA la cambia, pero ahí el map no la usa.
 */
function nginxUri(requestUri: string): string {
	const path = requestUri.split("?")[0] as string;
	try {
		return decodeURIComponent(path).replace(/\/{2,}/g, "/");
	} catch {
		return path;
	}
}

/**
 * Lo que acaba en el log para una URI de peticion, imitando lo que hace nginx.
 * Fuera de la API se parte de `$request_uri` y no de `$uri` porque `$uri` es la
 * ruta despues del try_files del SPA (revisión #524); en la API se parte de
 * `$uri`, la ruta ya decodificada sobre la que enruta Hono. Después se redacta.
 */
function uriMap(input: string): string {
	if (!rawPathMap || !queryMarkerMap || !requestPathMap || !pathMap) {
		throw new Error("Faltan los maps de la URI");
	}
	const query = input.includes("?") ? input.slice(input.indexOf("?") + 1) : "";
	const marker = evalMap(queryMarkerMap, query ? "?" : "");
	const path = evalMap(requestPathMap, nginxUri(input), {
		query_marker: marker,
		request_path_raw: evalMap(rawPathMap, input),
	});
	return evalMap(pathMap, path);
}

/** Lo que acaba en el log para el Referer: los dos maps encadenados. */
function refererMap(input: string): string {
	if (!refererPathMap || !refererRedactMap) {
		throw new Error("Faltan los maps del Referer");
	}
	return evalMap(refererRedactMap, evalMap(refererPathMap, input));
}

const FORMAT_NAME = "main_redacted";
// El formato `main` de nginx:alpine (combined + X-Forwarded-For) con la URI y
// el Referer redactados en lugar de `$request` y `$http_referer`.
const EXPECTED_FORMAT =
	'$remote_addr - $remote_user [$time_local] "$request_method $redacted_path $server_protocol" ' +
	'$status $body_bytes_sent "$redacted_referer" ' +
	'"$http_user_agent" "$http_x_forwarded_for"';

const HASH = "3f".repeat(32);
const TOKEN = "1793750400.Qm9ndXNUb2tlbkRlUHJ1ZWJhUXVlTm9EZWJlU2FsaXJYWA";
const PREVIEW_ID = "756f4e31-18e6-4f16-b868-516c5b945d8b";
const VERIFY_JWT =
	"eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5lcyJ9.c2VjcmV0by1kZS1wcnVlYmE";

describe("nginx.conf: el access_log no guarda URL de capacidad", () => {
	it("tiene los maps de la URI: quitar la query y redactar la ruta", () => {
		expect(rawPathMap).toBeDefined();
		expect(queryMarkerMap).toBeDefined();
		expect(requestPathMap).toBeDefined();
		expect(pathMap).toBeDefined();
		// Fuera de la API parte de $request_uri, no de $uri: $uri es la ruta
		// despues del try_files del SPA y el log perderia la ruta pedida
		// (revisión #524).
		expect(rawPathMap?.block?.find((e) => e.name === "default")?.args).toEqual([
			"$request_uri",
		]);
		expect(
			requestPathMap?.block?.find((e) => e.name === "default")?.args,
		).toEqual(["$request_path_raw"]);
		expect(pathMap?.block?.find((e) => e.name === "default")?.args).toEqual([
			"$request_path",
		]);
	});

	// El HTML del .elpx sale con Referrer-Policy: same-origin, así que sus
	// CSS, JS e imágenes llevan la URL firmada en el Referer.
	it("tiene los dos maps del Referer: quitar la query y redactar la ruta", () => {
		expect(refererPathMap).toBeDefined();
		expect(refererRedactMap).toBeDefined();
		// El primero parte del Referer en crudo y, sin query, lo deja igual.
		expect(
			refererPathMap?.block?.find((e) => e.name === "default")?.args,
		).toEqual(["$http_referer"]);
		// El segundo encadena sobre el resultado del primero.
		expect(
			refererRedactMap?.block?.find((e) => e.name === "default")?.args,
		).toEqual(["$referer_path"]);
	});

	it("define un log_format con los campos de main y la URI y el Referer redactados", () => {
		const format = all.find(
			(d) => d.name === "log_format" && d.args[0] === FORMAT_NAME,
		);
		expect(format).toBeDefined();
		expect(format?.args.slice(1).join("")).toBe(EXPECTED_FORMAT);
	});

	it("el server escribe el access_log con ese formato", () => {
		const server = conf.find((d) => d.name === "server");
		const accessLog = server?.block?.find((d) => d.name === "access_log");
		expect(accessLog?.args).toEqual(["/var/log/nginx/access.log", FORMAT_NAME]);
	});

	it("ningún access_log usa otro formato", () => {
		const accessLogs = all.filter((d) => d.name === "access_log");
		expect(accessLogs.length).toBeGreaterThan(0);
		for (const log of accessLogs) {
			if (log.args[0] === "off") continue;
			expect(log.args[1]).toBe(FORMAT_NAME);
		}
	});
});

const URI_CASES: [string, string, string][] = [
	[
		"enlace firmado (#466)",
		`/api/v1/elpx/preview/${HASH}/${TOKEN}/`,
		`/api/v1/elpx/preview/${HASH}/:token/`,
	],
	[
		"enlace firmado sin barra final",
		`/api/v1/elpx/preview/${HASH}/${TOKEN}`,
		`/api/v1/elpx/preview/${HASH}/:token`,
	],
	[
		"subpágina y recurso anidado del paquete",
		`/api/v1/elpx/preview/${HASH}/${TOKEN}/html/tema-2/actividad.html`,
		`/api/v1/elpx/preview/${HASH}/:token/html/tema-2/actividad.html`,
	],
	[
		"recurso del paquete con query",
		`/api/v1/elpx/preview/${HASH}/${TOKEN}/libs/jquery.js?v=3`,
		`/api/v1/elpx/preview/${HASH}/:token/libs/jquery.js?:query`,
	],
	[
		"token mal formado: se tapa igual",
		`/api/v1/elpx/preview/${HASH}/no-es-un-token/index.html`,
		`/api/v1/elpx/preview/${HASH}/:token/index.html`,
	],
	[
		"instantánea del editor (#317)",
		`/api/v1/preview/${PREVIEW_ID}/index.html`,
		"/api/v1/preview/:previewId/index.html",
	],
	[
		"instantánea del editor sin ruta",
		`/api/v1/preview/${PREVIEW_ID}`,
		"/api/v1/preview/:previewId",
	],
	[
		"sesión de vista previa (#317)",
		`/api/v1/preview-session/${PREVIEW_ID}`,
		"/api/v1/preview-session/:previewId",
	],
	[
		"subruta de la sesión de vista previa",
		`/api/v1/preview-session/${PREVIEW_ID}/assets`,
		"/api/v1/preview-session/:previewId/assets",
	],
	[
		"miniatura firmada de un recurso no publicado (#512)",
		`/api/v1/thumbnails/signed/${TOKEN}/${HASH}.jpg`,
		`/api/v1/thumbnails/signed/:token/${HASH}.jpg`,
	],
	[
		"verificación de correo de Better Auth (?token=)",
		`/api/auth/verify-email?token=${VERIFY_JWT}&callbackURL=%2F`,
		"/api/auth/verify-email?:query",
	],
	[
		"token como último parámetro",
		`/api/v1/algo?pagina=2&token=${VERIFY_JWT}`,
		"/api/v1/algo?:query",
	],
];

// Rutas sin capacidad: la ruta se conserva tal cual. Desde la revisión de
// #524 la query nunca se registra, asi que si la habia queda el marcador
// `?:query` en su lugar.
const UNCHANGED: [string, string][] = [
	["/", "/"],
	["/recursos/fotosintesis?page=2", "/recursos/fotosintesis?:query"],
	["/api/v1/resources/42/comments", "/api/v1/resources/42/comments"],
	[`/api/v1/elpx/${HASH}/index.html`, `/api/v1/elpx/${HASH}/index.html`],
	[`/api/v1/elpx/preview/${HASH}`, `/api/v1/elpx/preview/${HASH}`],
	["/api/v1/preview-session", "/api/v1/preview-session"],
	["/api/v1/previews/42", "/api/v1/previews/42"],
	[`/api/v1/thumbnails/${HASH}.jpg`, `/api/v1/thumbnails/${HASH}.jpg`],
	["/api/v1/search?q=token", "/api/v1/search?:query"],
	["/api/v1/search?q=preview&sort=recent", "/api/v1/search?:query"],
	["/api/v1/algo?access_token_hint=1", "/api/v1/algo?:query"],
];

// Hallazgos de la revisión de #524. Cada uno es una forma de colar un secreto
// en el access_log que las regex por nombre de parámetro no cubren.
const BYPASS_CASES: [string, string][] = [
	[
		"el mismo parámetro dos veces: la regex solo tapaba el último",
		`/api/auth/verify-email?token=${VERIFY_JWT}&token=${VERIFY_JWT}`,
	],
	[
		"nombre del parámetro percent-encoded: Better Auth lo decodifica igual",
		`/api/auth/verify-email?t%6fken=${VERIFY_JWT}`,
	],
	[
		"ruta sensible y query juntas: al casar la ruta no se tocaba la query",
		`/api/v1/preview/${PREVIEW_ID}/index.html?token=${VERIFY_JWT}`,
	],
];

// nginx registra $request_uri en crudo, pero Hono enruta sobre la ruta
// decodificada: estas llegan al handler con el permiso válido.
const ENCODED_CASES: [string, string, string][] = [
	[
		"segmento del prefijo con %xx",
		`/api/v1/elpx/previe%77/${HASH}/${TOKEN}/index.html`,
		`/api/v1/elpx/preview/${HASH}/:token/index.html`,
	],
	[
		"prefijo /api con %xx: la location de nginx también decodifica",
		`/%61pi/v1/elpx/preview/${HASH}/${TOKEN}/index.html`,
		`/api/v1/elpx/preview/${HASH}/:token/index.html`,
	],
	[
		"miniatura firmada con %xx",
		`/api/v1/thumbnails/%73igned/${TOKEN}/${HASH}.jpg?x=1`,
		`/api/v1/thumbnails/signed/:token/${HASH}.jpg?:query`,
	],
	[
		"instantánea del editor con %xx y barras repetidas",
		`/api/v1//pr%65view/${PREVIEW_ID}/index.html`,
		"/api/v1/preview/:previewId/index.html",
	],
];

describe("una ruta con %xx no se salta la redacción (revisión #524)", () => {
	for (const [label, input, expected] of ENCODED_CASES) {
		it(`URI: ${label}`, () => {
			expect(uriMap(input)).toBe(expected);
		});

		// El navegador manda el Referer tal cual lo pidió, sin decodificar.
		it(`Referer: ${label}`, () => {
			const out = refererMap(`https://procomun.example${input}`);
			expect(out).not.toContain(TOKEN);
			expect(out).not.toContain(PREVIEW_ID);
		});
	}

	it("fuera de la API se registra la ruta pedida, no la del try_files", () => {
		expect(uriMap("/recursos/fotos%C3%ADntesis")).toBe(
			"/recursos/fotos%C3%ADntesis",
		);
	});
});

describe("ninguna variante deja un secreto en el log (revisión #524)", () => {
	for (const [label, input] of BYPASS_CASES) {
		it(`URI: ${label}`, () => {
			expect(uriMap(input)).not.toContain(VERIFY_JWT);
		});

		it(`Referer: ${label}`, () => {
			expect(refererMap(`https://procomun.example${input}`)).not.toContain(
				VERIFY_JWT,
			);
		});
	}
});

describe("map $request_uri → $redacted_uri", () => {
	for (const [label, input, expected] of URI_CASES) {
		it(`tapa la capacidad: ${label}`, () => {
			expect(uriMap(input)).toBe(expected);
		});
	}

	it("no deja ningún secreto de los ejemplos en la URI redactada", () => {
		for (const [, input] of URI_CASES) {
			const out = uriMap(input);
			for (const secret of [TOKEN, PREVIEW_ID, VERIFY_JWT, "no-es-un-token"]) {
				expect(out).not.toContain(secret);
			}
		}
	});

	it("tapa el token del enlace que genera de verdad la API", () => {
		const url = buildSignedElpxPreviewUrl(HASH);
		const token = url.slice(`${ELPX_PREVIEW_PREFIX}/${HASH}/`.length, -1);
		expect(token.length).toBeGreaterThan(40);
		expect(uriMap(`${url}html/pagina.html`)).toBe(
			`${ELPX_PREVIEW_PREFIX}/${HASH}/:token/html/pagina.html`,
		);
	});

	for (const [input, expected] of UNCHANGED) {
		it(`conserva la ruta de una URI sin capacidad: ${input}`, () => {
			expect(uriMap(input)).toBe(expected);
		});
	}

	// Con una línea de petición mal formada $request_uri llega vacía. Se
	// escribe "-" y no la línea en crudo, que no pasaría por la redacción.
	it("escribe - si la petición no trae URI", () => {
		expect(uriMap("")).toBe("-");
	});
});

describe("map $http_referer → $redacted_referer", () => {
	const ORIGIN = "https://procomun.example";

	for (const [label, input, expected] of URI_CASES) {
		it(`tapa la capacidad en el Referer: ${label}`, () => {
			expect(refererMap(`${ORIGIN}${input}`)).toBe(`${ORIGIN}${expected}`);
		});
	}

	it("tapa también un Referer con puerto y http", () => {
		expect(
			refererMap(
				`http://localhost:8080/api/v1/elpx/preview/${HASH}/${TOKEN}/index.html`,
			),
		).toBe(
			`http://localhost:8080/api/v1/elpx/preview/${HASH}/:token/index.html`,
		);
	});

	for (const [input, expected] of UNCHANGED) {
		it(`conserva la ruta de un Referer sin capacidad: ${input}`, () => {
			expect(refererMap(`${ORIGIN}${input}`)).toBe(`${ORIGIN}${expected}`);
		});
	}

	// Sin la cabecera, $http_referer sale "-" en el formato main. El map da
	// una cadena vacía, así que se pone "-" a mano para no cambiar el log.
	it("escribe - si no hay Referer, como el formato main", () => {
		expect(refererMap("")).toBe("-");
	});
});
