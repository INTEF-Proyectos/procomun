import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardSummary } from "../../lib/types/user-extended.ts";
import {
	hasEmailVerificationSuccess,
	PublicDashboardIsland,
	withFavoriteCount,
} from "./PublicDashboardIsland.tsx";

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
