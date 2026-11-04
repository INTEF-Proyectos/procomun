import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardSummary } from "../../lib/types/user-extended.ts";
import {
	hasEmailVerificationSuccess,
	PublicDashboardIsland,
	roleLabel,
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

	test("ninguna etiqueta es la clave en mayusculas, que era el defecto", () => {
		for (const role of ["reader", "author", "curator", "admin"]) {
			expect(roleLabel(role)).not.toBe(role.toUpperCase());
			expect(roleLabel(role)).not.toBe(role);
		}
	});
});
