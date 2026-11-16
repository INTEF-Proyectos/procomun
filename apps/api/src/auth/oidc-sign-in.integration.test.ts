import { afterAll, describe, expect, test } from "bun:test";
import { HttpApiClient } from "../../../frontend/src/lib/http-api-client.ts";
import { createAuth } from "./config.ts";

// Acceso institucional (OIDC) de principio a fin (#527). Better Auth 1.7 dejó
// de servir /sign-in/oauth2 y /oauth2/callback/:id, el botón seguía llamando al
// primero y el test unitario del cliente no lo vio porque simula fetch. Aquí el
// inicio lo hace el cliente real del frontend contra la instancia real de
// Better Auth, y el proveedor de prueba se comporta como uno de verdad: solo
// acepta la URL de retorno dada de alta, comprueba PKCE y firma el id_token.

const APP_URL = "https://procomun.example.test";
/** La URL de retorno que se da de alta en el proveedor (ADR-0007, .env.example). */
const REGISTERED_REDIRECT_URI = `${APP_URL}/api/auth/callback/oidc`;
const CLIENT_ID = "procomun-test";
const CLIENT_SECRET = "secreto-de-prueba";
const KEY_ID = "clave-de-prueba";

const realFetch = globalThis.fetch;

function base64url(data: string | ArrayBuffer) {
	return Buffer.from(
		typeof data === "string" ? data : new Uint8Array(data),
	).toString("base64url");
}

async function sha256(value: string) {
	return base64url(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);
}

const signingKey = await crypto.subtle.generateKey(
	{
		name: "RSASSA-PKCS1-v1_5",
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1]),
		hash: "SHA-256",
	},
	true,
	["sign", "verify"],
);
const { kty, n, e } = await crypto.subtle.exportKey(
	"jwk",
	signingKey.publicKey,
);

async function signIdToken(claims: Record<string, unknown>) {
	const header = base64url(
		JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }),
	);
	const payload = base64url(JSON.stringify(claims));
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		signingKey.privateKey,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${base64url(signature)}`;
}

type PendingCode = { challenge: string; nonce: string; redirectUri: string };

/** Proveedor OIDC de prueba. Rechaza lo que rechazaría uno real. */
function startFakeProvider() {
	let user = { sub: "", email: "", name: "" };
	const codes = new Map<string, PendingCode>();
	const accessTokens = new Set<string>();
	const calls: string[] = [];

	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const issuer = url.origin;
			calls.push(url.pathname);

			if (url.pathname === "/.well-known/openid-configuration") {
				return Response.json({
					issuer,
					authorization_endpoint: `${issuer}/authorize`,
					token_endpoint: `${issuer}/token`,
					userinfo_endpoint: `${issuer}/userinfo`,
					jwks_uri: `${issuer}/jwks`,
					response_types_supported: ["code"],
					subject_types_supported: ["public"],
					id_token_signing_alg_values_supported: ["RS256"],
					code_challenge_methods_supported: ["S256"],
					authorization_response_iss_parameter_supported: true,
				});
			}

			if (url.pathname === "/jwks") {
				return Response.json({
					keys: [{ kty, n, e, kid: KEY_ID, alg: "RS256", use: "sig" }],
				});
			}

			if (url.pathname === "/authorize") {
				const query = url.searchParams;
				const redirectUri = query.get("redirect_uri") ?? "";
				// Un proveedor real no devuelve el código a una URL que no conoce.
				if (redirectUri !== REGISTERED_REDIRECT_URI) {
					return new Response(`redirect_uri no registrada: ${redirectUri}`, {
						status: 400,
					});
				}
				if (
					query.get("client_id") !== CLIENT_ID ||
					query.get("response_type") !== "code" ||
					!query.get("scope")?.split(" ").includes("openid") ||
					query.get("code_challenge_method") !== "S256" ||
					!query.get("code_challenge") ||
					!query.get("nonce")
				) {
					return new Response("petición de autorización no válida", {
						status: 400,
					});
				}
				// El usuario se identifica en el proveedor y vuelve con un código.
				const code = crypto.randomUUID();
				codes.set(code, {
					challenge: query.get("code_challenge") ?? "",
					nonce: query.get("nonce") ?? "",
					redirectUri,
				});
				const back = new URL(redirectUri);
				back.searchParams.set("code", code);
				back.searchParams.set("state", query.get("state") ?? "");
				back.searchParams.set("iss", issuer);
				return Response.redirect(back.href, 302);
			}

			if (url.pathname === "/token" && request.method === "POST") {
				const form = new URLSearchParams(await request.text());
				const basic = request.headers.get("authorization") ?? "";
				const [basicId, basicSecret] = basic.startsWith("Basic ")
					? Buffer.from(basic.slice(6), "base64").toString().split(":")
					: [form.get("client_id"), form.get("client_secret")];
				const code = form.get("code") ?? "";
				const pending = codes.get(code);
				codes.delete(code);
				if (
					basicId !== CLIENT_ID ||
					basicSecret !== CLIENT_SECRET ||
					form.get("grant_type") !== "authorization_code" ||
					!pending ||
					form.get("redirect_uri") !== pending.redirectUri ||
					(await sha256(form.get("code_verifier") ?? "")) !== pending.challenge
				) {
					return Response.json({ error: "invalid_grant" }, { status: 400 });
				}
				const accessToken = crypto.randomUUID();
				accessTokens.add(accessToken);
				const now = Math.floor(Date.now() / 1000);
				return Response.json({
					access_token: accessToken,
					token_type: "Bearer",
					expires_in: 3600,
					// Sin email en el id_token: como muchos proveedores, los datos
					// del perfil se piden a userinfo.
					id_token: await signIdToken({
						iss: issuer,
						sub: user.sub,
						aud: CLIENT_ID,
						iat: now,
						exp: now + 300,
						nonce: pending.nonce,
					}),
				});
			}

			if (url.pathname === "/userinfo") {
				const token = (request.headers.get("authorization") ?? "").replace(
					/^Bearer /,
					"",
				);
				if (!accessTokens.has(token)) {
					return Response.json({ error: "invalid_token" }, { status: 401 });
				}
				return Response.json({ ...user, email_verified: true });
			}

			return new Response("Not found", { status: 404 });
		},
	});

	return {
		server,
		calls,
		signInAs(next: typeof user) {
			user = next;
		},
	};
}

/** Navegador mínimo: cookies de Procomún y cabecera Origin, como en el login. */
function createBrowser(handler: (request: Request) => Promise<Response>) {
	const jar = new Map<string, string>();

	async function visitApp(target: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		headers.set("Origin", APP_URL);
		if (jar.size > 0) {
			headers.set(
				"Cookie",
				[...jar].map(([name, value]) => `${name}=${value}`).join("; "),
			);
		}
		const response = await handler(
			new Request(new URL(target, APP_URL), { ...init, headers }),
		);
		for (const cookie of response.headers.getSetCookie()) {
			const [pair = ""] = cookie.split(";");
			const separator = pair.indexOf("=");
			const name = pair.slice(0, separator).trim();
			const value = pair.slice(separator + 1);
			if (value === "" || /max-age=0/i.test(cookie)) jar.delete(name);
			else jar.set(name, value);
		}
		return response;
	}

	/** Ejecuta código del frontend con su fetch apuntando a Procomún. */
	async function runFrontend<T>(action: () => Promise<T>) {
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const target = new URL(
				input instanceof Request ? input.url : String(input),
				APP_URL,
			);
			if (target.origin === APP_URL) return visitApp(target.href, init);
			return realFetch(input, init);
		}) as unknown as typeof fetch;
		try {
			return await action();
		} finally {
			globalThis.fetch = realFetch;
		}
	}

	return { visitApp, runFrontend };
}

describe("acceso institucional OIDC de principio a fin (#527)", () => {
	const provider = startFakeProvider();
	afterAll(() => provider.server.stop(true));

	const oidcAuth = createAuth({
		...process.env,
		BETTER_AUTH_URL: APP_URL,
		FRONTEND_URL: APP_URL,
		OIDC_ENABLED: "true",
		OIDC_ISSUER: provider.server.url.origin,
		OIDC_CLIENT_ID: CLIENT_ID,
		OIDC_CLIENT_SECRET: CLIENT_SECRET,
		OIDC_SCOPE: "openid email profile",
	});

	test("el botón de acceso institucional termina con una sesión abierta", async () => {
		const sub = crypto.randomUUID();
		const email = `docente-${sub}@centro.test`;
		provider.signInAs({ sub, email, name: "Docente OIDC" });
		const browser = createBrowser(oidcAuth.handler);

		// 1. El botón: el mismo cliente que usa LoginIsland.
		const start = await browser.runFrontend(() =>
			new HttpApiClient().signInOidc(),
		);
		expect(start).toMatchObject({ ok: true });
		const authorizeUrl = new URL(start.redirectUrl ?? "");
		expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(
			`${provider.server.url.origin}/authorize`,
		);
		expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
			REGISTERED_REDIRECT_URI,
		);

		// 2. El navegador va al proveedor, que devuelve a Procomún con un código.
		const authorize = await realFetch(authorizeUrl, { redirect: "manual" });
		expect(authorize.status).toBe(302);
		const providerCallback = authorize.headers.get("location") ?? "";
		expect(providerCallback.startsWith(`${REGISTERED_REDIRECT_URI}?`)).toBe(
			true,
		);

		// 3. Better Auth canjea el código, lee userinfo y abre la sesión.
		const callback = await browser.visitApp(providerCallback, {
			method: "GET",
			redirect: "manual",
		});
		expect(callback.status).toBe(302);
		const landing = new URL(callback.headers.get("location") ?? "", APP_URL);
		expect(landing.searchParams.get("error")).toBeNull();
		expect(landing.pathname).toBe("/admin");

		const session = await browser.visitApp("/api/auth/get-session", {
			method: "GET",
		});
		const body = (await session.json()) as { user?: { email?: string } };
		expect(body.user?.email).toBe(email);

		const accounts = await browser.visitApp("/api/auth/list-accounts", {
			method: "GET",
		});
		expect(await accounts.json()).toEqual([
			expect.objectContaining({ providerId: "oidc", accountId: sub }),
		]);

		for (const step of ["/authorize", "/token", "/jwks", "/userinfo"]) {
			expect(provider.calls).toContain(step);
		}
	});
});
