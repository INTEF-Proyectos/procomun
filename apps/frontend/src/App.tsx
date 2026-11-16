import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { PublicLayout } from "./layouts/PublicLayout.tsx";

const HomePage = lazy(() => import("./pages/HomePage.tsx"));
const ExplorarPage = lazy(() => import("./pages/ExplorarPage.tsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.tsx"));
const RegistroPage = lazy(() => import("./pages/RegistroPage.tsx"));
// #531: recuperar la contraseña olvidada.
const RecuperarPage = lazy(() => import("./pages/RecuperarPage.tsx"));
const RestablecerPage = lazy(() => import("./pages/RestablecerPage.tsx"));
const PerfilPage = lazy(() => import("./pages/PerfilPage.tsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.tsx"));
const RecursoPage = lazy(() => import("./pages/RecursoPage.tsx"));
const AyudaPage = lazy(() => import("./pages/AyudaPage.tsx"));
const ColeccionesPage = lazy(() => import("./pages/ColeccionesPage.tsx"));
const TagPage = lazy(() => import("./pages/TagPage.tsx"));
const AutorPage = lazy(() => import("./pages/AutorPage.tsx"));
const EditarPage = lazy(() => import("./pages/EditarPage.tsx"));
const NuevoPage = lazy(() => import("./pages/NuevoPage.tsx"));

const VALID_LOCALES = new Set(["en", "ca", "gl", "eu"]);

export function canAccessAdminPanel(role?: string): boolean {
	return role === "curator" || role === "admin";
}

/** Syncs <html lang> when the :locale param changes. */
function LocaleSync() {
	const { locale } = useParams<{ locale?: string }>();
	const effectiveLocale = locale && VALID_LOCALES.has(locale) ? locale : "es";

	useEffect(() => {
		document.documentElement.lang = effectiveLocale;
	}, [effectiveLocale]);

	return null;
}

/** Shared route definitions used for both default and locale-prefixed paths. */
function AppRoutes() {
	return (
		<>
			<Route index element={<HomePage />} />
			<Route path="explorar" element={<ExplorarPage />} />
			<Route path="buscar" element={<Navigate to="explorar" replace />} />
			<Route path="login" element={<LoginPage />} />
			<Route path="registro" element={<RegistroPage />} />
			<Route path="recuperar" element={<RecuperarPage />} />
			<Route path="restablecer" element={<RestablecerPage />} />
			<Route path="perfil" element={<PerfilPage />} />
			<Route path="admin/*" element={<AdminPage />} />
			<Route path="recurso" element={<RecursoPage />} />
			<Route path="ayuda" element={<AyudaPage />} />
			<Route path="colecciones" element={<ColeccionesPage />} />
			<Route path="tags/:slug" element={<TagPage />} />
			<Route path="autor/:id" element={<AutorPage />} />
			<Route path="editar" element={<EditarPage />} />
			<Route path="nuevo" element={<NuevoPage />} />
		</>
	);
}

export function App() {
	return (
		<Suspense fallback={null}>
			<Routes>
				{/* Default locale (es) — no prefix */}
				<Route
					element={
						<>
							<LocaleSync />
							<PublicLayout />
						</>
					}
				>
					{AppRoutes()}
				</Route>

				{/* Non-default locales — /en/*, /ca/*, /gl/*, /eu/* */}
				<Route
					path=":locale"
					element={
						<>
							<LocaleSync />
							<PublicLayout />
						</>
					}
				>
					{AppRoutes()}
				</Route>
			</Routes>
		</Suspense>
	);
}
