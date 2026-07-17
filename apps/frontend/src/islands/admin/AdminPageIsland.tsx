import { useEffect, useState } from "react";
import { getApiClient } from "../../lib/get-api-client.ts";
import { url } from "../../lib/paths.ts";
import { ROLE_LEVELS } from "../../lib/shared-utils.ts";
import { AdminApiTokensSection } from "./AdminApiTokensSection.tsx";
import { AdminCategoriesSection } from "./AdminCategoriesSection.tsx";
import { AdminCollectionsSection } from "./AdminCollectionsSection.tsx";
import { AdminDashboardSection } from "./AdminDashboardSection.tsx";
import { AdminReportsSection } from "./AdminReportsSection.tsx";
import { AdminResourcesSection } from "./AdminResourcesSection.tsx";
import { AdminSidebar } from "./AdminSidebar.tsx";
import { AdminUsersSection } from "./AdminUsersSection.tsx";
import { resolveAdminSection, SECTION_MIN_ROLE } from "./admin-sections.ts";
import "./AdminPageIsland.css";

export type AdminSection =
	| "dashboard"
	| "resources"
	| "collections"
	| "categories"
	| "reports"
	| "users"
	| "api-tokens";

export function AdminPageIsland() {
	const [section, setSection] = useState<AdminSection>("dashboard");
	const [userRole, setUserRole] = useState<string>("");
	const [userName, setUserName] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			try {
				const api = await getApiClient();
				const session = await api.getSession();
				if (
					!session?.user ||
					(ROLE_LEVELS[session.user.role] ?? 0) < ROLE_LEVELS.curator
				) {
					window.location.href = session?.user ? url("perfil") : url("login");
					return;
				}
				setUserRole(session.user.role);
				setUserName(session.user.name || session.user.email);

				// DEF-021: respeta la sección solicitada por URL solo si el rol tiene
				// privilegios suficientes; de lo contrario, deniega el acceso cayendo
				// en el dashboard (evita mostrar un panel en blanco).
				const userLevel = ROLE_LEVELS[session.user.role] ?? 0;
				const requested = new URLSearchParams(window.location.search).get(
					"section",
				);
				const resolved = resolveAdminSection(requested, userLevel);
				setSection(resolved);
				if (requested && requested !== resolved) {
					const cleanUrl = new URL(window.location.href);
					cleanUrl.searchParams.set("section", resolved);
					window.history.replaceState({}, "", cleanUrl.toString());
				}
			} catch {
				window.location.href = url("login");
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	function changeSection(s: AdminSection) {
		// Defensa adicional: ignora secciones por encima del nivel del usuario.
		if ((ROLE_LEVELS[userRole] ?? 0) < SECTION_MIN_ROLE[s]) return;
		setSection(s);
		const newUrl = new URL(window.location.href);
		newUrl.searchParams.set("section", s);
		window.history.pushState({}, "", newUrl.toString());
	}

	if (loading) {
		return (
			<div className="admin-loading">Cargando panel de administracion...</div>
		);
	}

	const userLevel = ROLE_LEVELS[userRole] ?? 0;
	const canManageCollections = userLevel >= ROLE_LEVELS.curator;
	const canManageCategories = userLevel >= ROLE_LEVELS.curator;

	return (
		<div className="admin-shell">
			<AdminSidebar
				activeSection={section}
				onSectionChange={changeSection}
				userRole={userRole}
				userName={userName}
			/>
			<main className="admin-content">
				{section === "dashboard" && (
					<AdminDashboardSection
						onNavigate={changeSection}
						canManageCollections={canManageCollections}
						canManageCategories={canManageCategories}
					/>
				)}
				{section === "resources" && <AdminResourcesSection />}
				{section === "collections" && canManageCollections && (
					<AdminCollectionsSection />
				)}
				{section === "categories" && canManageCategories && (
					<AdminCategoriesSection />
				)}
				{section === "reports" && userLevel >= ROLE_LEVELS.curator && (
					<AdminReportsSection />
				)}
				{section === "users" && userLevel >= ROLE_LEVELS.admin && (
					<AdminUsersSection />
				)}
				{section === "api-tokens" && userLevel >= ROLE_LEVELS.admin && (
					<AdminApiTokensSection />
				)}
			</main>
		</div>
	);
}
