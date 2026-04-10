import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";
import { PublicLayout } from "./layouts/PublicLayout.tsx";

const HomePage = lazy(() => import("./pages/HomePage.tsx"));
const ExplorarPage = lazy(() => import("./pages/ExplorarPage.tsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.tsx"));
const RegistroPage = lazy(() => import("./pages/RegistroPage.tsx"));
const PerfilPage = lazy(() => import("./pages/PerfilPage.tsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.tsx"));
const RecursoPage = lazy(() => import("./pages/RecursoPage.tsx"));
const AyudaPage = lazy(() => import("./pages/AyudaPage.tsx"));
const ColeccionesPage = lazy(() => import("./pages/ColeccionesPage.tsx"));
const EditarPage = lazy(() => import("./pages/EditarPage.tsx"));
const NuevoPage = lazy(() => import("./pages/NuevoPage.tsx"));

const VALID_LOCALES = new Set(["es", "en", "ca", "gl", "eu"]);

function LocaleSync() {
	const { locale } = useParams<{ locale?: string }>();
	const effectiveLocale = locale && VALID_LOCALES.has(locale) ? locale : "es";

	useEffect(() => {
		document.documentElement.lang = effectiveLocale;
	}, [effectiveLocale]);

	return null;
}

function PageRoutes() {
	return (
		<>
			<LocaleSync />
			<Suspense fallback={null}>
				<Routes>
					<Route element={<PublicLayout />}>
						<Route index element={<HomePage />} />
						<Route path="explorar" element={<ExplorarPage />} />
						<Route path="buscar" element={<Navigate to="../explorar" replace />} />
						<Route path="login" element={<LoginPage />} />
						<Route path="registro" element={<RegistroPage />} />
						<Route path="perfil" element={<PerfilPage />} />
						<Route path="admin/*" element={<AdminPage />} />
						<Route path="recurso" element={<RecursoPage />} />
						<Route path="ayuda" element={<AyudaPage />} />
						<Route path="colecciones" element={<ColeccionesPage />} />
						<Route path="editar" element={<EditarPage />} />
						<Route path="nuevo" element={<NuevoPage />} />
					</Route>
				</Routes>
			</Suspense>
		</>
	);
}

export function App() {
	return (
		<Routes>
			<Route path="/*" element={<PageRoutes />} />
			<Route path=":locale/*" element={<PageRoutes />} />
		</Routes>
	);
}
