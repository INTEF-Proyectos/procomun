import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardSummary } from "../../lib/types/user-extended.ts";
import {
	hasEmailVerificationSuccess,
	PROFILE_TABS,
	PublicDashboardIsland,
	profileAvatarUrl,
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
	recentResources: [],
	draftCount: 1,
	publishedCount: 1,
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

// #532: el enlace que verifica un correo nuevo vuelve a /perfil?tab=account
// (lo fija changeEmail en http-api-client.ts). Si la pestaña no estuviera en la
// lista, el usuario caería en otra sin saber si el cambio ha ido bien.
describe("vuelta a la pestaña Cuenta (#532)", () => {
	test("?tab=account abre la pestaña Cuenta", () => {
		const tab = new URLSearchParams("?tab=account").get("tab") ?? "";
		expect(PROFILE_TABS).toContain(tab);
	});
});
