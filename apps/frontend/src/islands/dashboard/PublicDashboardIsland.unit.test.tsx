import { describe, expect, test } from "bun:test";
import { EMPTY_PROFILE_DETAILS } from "@procomun/db/user-profile";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardSummary } from "../../lib/types/user-extended.ts";
import {
	dashboardResourceCounts,
	detectOwnCollections,
	hasEmailVerificationSuccess,
	PROFILE_TABS,
	PublicDashboardIsland,
	profileAvatarUrl,
	profileChanges,
	roleLabel,
	withFavoriteCount,
} from "./PublicDashboardIsland.tsx";

function sha256Hex(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

const baseDashboard: DashboardSummary = {
	user: {
		id: "u1",
		name: "Ana",
		avatarUrl: null,
		bio: null,
		role: "author",
		resourceCount: 2,
		favoriteCount: 1,
		joinedAt: "",
	},
	draftCount: 1,
	publishedCount: 1,
	reviewCount: 0,
	archivedCount: 0,
	resourceCount: 2,
	favoriteCount: 1,
	recentActivity: [],
};

describe("withFavoriteCount (DEF-005 / #202)", () => {
	test("actualiza el contador en el resumen y en el usuario del perfil", () => {
		const next = withFavoriteCount(baseDashboard, 4);
		expect(next.favoriteCount).toBe(4);
		expect(next.user.favoriteCount).toBe(4);
		expect(next.user.name).toBe("Ana");
		expect(next.publishedCount).toBe(1);
	});

	test("no permite contadores negativos", () => {
		expect(withFavoriteCount(baseDashboard, -3).favoriteCount).toBe(0);
		expect(withFavoriteCount(baseDashboard, -3).user.favoriteCount).toBe(0);
	});
});

describe("profileAvatarUrl (#514)", () => {
	test("usa el correo de la sesión y no un correo inventado con el id", async () => {
		const sessionUser = { id: "u1", email: "Docente.Prueba@example.org " };
		const url = await profileAvatarUrl(sessionUser);

		expect(url).toBe(
			`https://www.gravatar.com/avatar/${sha256Hex("docente.prueba@example.org")}?s=192&d=mp`,
		);
		expect(url).not.toContain(sha256Hex("u1@procomun.es"));
	});
});

describe("PublicDashboardIsland", () => {
	test("detecta el retorno desde una verificación de correo", () => {
		expect(hasEmailVerificationSuccess("?verified=1")).toBeTrue();
		expect(hasEmailVerificationSuccess("?tab=resources")).toBeFalse();
	});

	test("muestra el shell de carga inicial del perfil", () => {
		const html = renderToStaticMarkup(<PublicDashboardIsland />);
		expect(html).toContain("dashboard-loading");
	});
});

describe("dashboardResourceCounts (#530)", () => {
	test("el total incluye los recursos en revisión y los archivados", () => {
		expect(
			dashboardResourceCounts({
				draftCount: 2,
				publishedCount: 3,
				reviewCount: 4,
				archivedCount: 1,
			}),
		).toEqual({
			draftCount: 2,
			publishedCount: 3,
			reviewCount: 4,
			archivedCount: 1,
			resourceCount: 10,
		});
	});

	test("usa el total de la API cuando viene", () => {
		expect(
			dashboardResourceCounts({ draftCount: 1, resourceCount: 7 })
				.resourceCount,
		).toBe(7);
	});
});

// #532: el enlace que verifica un correo nuevo vuelve a /perfil?tab=account
// (lo fija changeEmail en http-api-client.ts). Si la pestaña no estuviera en la
// lista, el usuario caería en otra sin saber si el cambio ha ido bien.
describe("vuelta a la pestaña Cuenta (#532)", () => {
	test("?tab=account abre la pestaña Cuenta", () => {
		const tab = new URLSearchParams("?tab=account").get("tab") ?? "";
		expect(PROFILE_TABS).toContain(tab);
	});
});

// #534: la insignia de rol pintaba `user.role` en crudo, asi que se veia la
// clave sin traducir («AUTHOR», en mayusculas por el CSS de la insignia).
describe("roleLabel (#534)", () => {
	test("traduce los cinco roles con las etiquetas de la administracion", () => {
		// Las mismas que ROLE_OPTIONS de AdminUsersSection, para que el perfil y
		// la administracion no llamen distinto al mismo rol.
		expect(roleLabel("reader")).toBe("Lector");
		expect(roleLabel("author")).toBe("Autor");
		expect(roleLabel("editor")).toBe("Editor");
		expect(roleLabel("curator")).toBe("Curador");
		expect(roleLabel("admin")).toBe("Administrador");
	});

	test("un rol desconocido, vacio o ausente cae en lector", () => {
		const reader = roleLabel("reader");
		expect(roleLabel("superadmin")).toBe(reader);
		expect(roleLabel("")).toBe(reader);
		expect(roleLabel(undefined)).toBe(reader);
		expect(roleLabel(null)).toBe(reader);
	});

	test("las claves heredadas del prototipo caen en lector sin lanzar", () => {
		// `ROLE_LABELS` es un objeto literal: `__proto__` o `toString` no son
		// roles, pero se resuelven por el prototipo y no son traductores.
		const reader = roleLabel("reader");
		for (const key of [
			"__proto__",
			"constructor",
			"toString",
			"hasOwnProperty",
		]) {
			expect(() => roleLabel(key)).not.toThrow();
			expect(roleLabel(key)).toBe(reader);
		}
	});

	test("ninguna etiqueta es la clave en mayusculas, que era el defecto", () => {
		for (const role of ["reader", "author", "curator", "admin"]) {
			expect(roleLabel(role)).not.toBe(role.toUpperCase());
			expect(roleLabel(role)).not.toBe(role);
		}
	});
});

describe("profileChanges (#533, revisión de #586)", () => {
	const empty = {
		name: "Ana",
		bio: "",
		details: { ...EMPTY_PROFILE_DETAILS },
	};

	test("si falló la lectura del perfil, guardar el nombre no envía la bio ni los datos ampliados", () => {
		// El formulario parte de valores vacíos porque getMyProfile() falló.
		expect(profileChanges(empty, { ...empty, name: "Ana María" })).toEqual({
			name: "Ana María",
		});
	});

	test("una cuenta con un país importado como XK edita el nombre sin enviar el país", () => {
		const imported = {
			...empty,
			bio: "Sobre mí importado",
			details: { ...EMPTY_PROFILE_DETAILS, countryCode: "XK" },
		};
		expect(
			profileChanges(imported, { ...imported, name: "Ana María" }),
		).toEqual({ name: "Ana María" });
	});

	test("envía solo los campos que cambian, también al vaciarlos", () => {
		const original = {
			...empty,
			bio: "Antes",
			details: { ...EMPTY_PROFILE_DETAILS, locality: "Burgos" },
		};
		expect(
			profileChanges(original, {
				...original,
				bio: "",
				details: { ...original.details, locality: "", twitter: "@ana" },
			}),
		).toEqual({ bio: "", profile: { locality: "", twitter: "@ana" } });
		expect(profileChanges(original, original)).toEqual({});
	});
});

describe("detectOwnCollections (#575)", () => {
	const withTotal = (total: number) => () => Promise.resolve({ total });

	test("solo consulta para autores y editores", async () => {
		let calls = 0;
		const list = () => {
			calls++;
			return Promise.resolve({ total: 3 });
		};
		expect(await detectOwnCollections("viewer", list)).toBe(false);
		expect(await detectOwnCollections("curator", list)).toBe(false);
		expect(await detectOwnCollections("admin", list)).toBe(false);
		expect(calls).toBe(0);
		expect(await detectOwnCollections("author", list)).toBe(true);
		expect(await detectOwnCollections("editor", withTotal(0))).toBe(false);
	});

	test("un fallo devuelve null para no ocultar la pestaña abierta", async () => {
		expect(
			await detectOwnCollections("editor", () =>
				Promise.reject(new Error("500")),
			),
		).toBeNull();
	});
});
