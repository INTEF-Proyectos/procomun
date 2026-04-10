import { useEffect } from "react";
import { Outlet, Link, useParams, useLocation } from "react-router-dom";
import { PublicNavIsland } from "../islands/layout/PublicNavIsland.tsx";
import { HELP_FOOTER_LINKS, buildHelpHref } from "../lib/help-content.ts";
import * as m from "../paraglide/messages.js";
import "../styles/public-layout.css";

const VALID_LOCALES = new Set(["es", "en", "ca", "gl", "eu"]);

export function PublicLayout() {
	const { locale } = useParams<{ locale?: string }>();
	const location = useLocation();
	const effectiveLocale = locale && VALID_LOCALES.has(locale) ? locale : "es";

	function localUrl(path: string): string {
		const clean = path.replace(/^\//, "");
		if (effectiveLocale === "es") return `/${clean}`;
		return `/${effectiveLocale}/${clean}`;
	}

	const normalizedPath = location.pathname.replace(/^\/(?:en|ca|gl|eu)\//, "/");

	const activePage = (() => {
		if (normalizedPath === "/") return "inicio";
		if (normalizedPath.startsWith("/explorar")) return "explorar";
		if (normalizedPath.startsWith("/colecciones")) return "colecciones";
		if (normalizedPath.startsWith("/ayuda")) return "ayuda";
		return "";
	})();

	const fullWidth = normalizedPath === "/";
	const showNavSearch = ["/explorar", "/colecciones", "/ayuda", "/recurso", "/perfil", "/registro", "/admin"].some(
		(p) => normalizedPath.startsWith(p),
	);

	useEffect(() => {
		document.body.classList.toggle("nav-search-visible", showNavSearch);
		return () => document.body.classList.remove("nav-search-visible");
	}, [showNavSearch]);

	return (
		<>
			<a href="#main-content" className="sr-only">{m.skip_to_content()}</a>

			<nav className="public-nav-bar" aria-label={m.main_navigation()}>
				<div className="public-nav-inner">
					<div className="public-nav-left">
						<Link to={localUrl("")} className="public-brand">Procomún</Link>
						<div className="public-nav-links">
							<Link to={localUrl("")} className={`public-nav-link${activePage === "inicio" ? " public-nav-link-active" : ""}`}>{m.nav_home()}</Link>
							<Link to={localUrl("explorar")} className={`public-nav-link${activePage === "explorar" ? " public-nav-link-active" : ""}`}>{m.nav_explore()}</Link>
							<Link to={localUrl("colecciones")} className={`public-nav-link${activePage === "colecciones" ? " public-nav-link-active" : ""}`}>{m.footer_collections()}</Link>
							<Link to={`/${buildHelpHref()}`} className={`public-nav-link${activePage === "ayuda" ? " public-nav-link-active" : ""}`}>Ayuda</Link>
						</div>
					</div>
					<div className="public-nav-search" id="nav-search">
						<form action={localUrl("explorar")} method="get" className="public-nav-search-form" role="search">
							<span className="material-symbols-outlined public-nav-search-icon" aria-hidden="true">search</span>
							<input
								type="search"
								name="q"
								className="public-nav-search-input"
								placeholder={m.nav_search_placeholder()}
								aria-label={m.nav_search_label()}
							/>
						</form>
					</div>
					<PublicNavIsland />
				</div>
				<div className="public-nav-separator" />
			</nav>

			<main id="main-content" className={fullWidth ? "public-main-full" : "public-main"}>
				<Outlet />
			</main>

			<footer className="public-footer" role="contentinfo">
				<div className="public-footer-grid">
					<div className="public-footer-brand">
						<span className="public-footer-logo">Procomún</span>
						<p className="public-footer-desc">{m.footer_desc()}</p>
						<div className="public-footer-social">
							<a href="#" className="public-footer-social-icon" aria-label={m.footer_share()}><span className="material-symbols-outlined">share</span></a>
							<a href="#" className="public-footer-social-icon" aria-label={m.footer_web()}><span className="material-symbols-outlined">public</span></a>
							<a href="#" className="public-footer-social-icon" aria-label={m.footer_email()}><span className="material-symbols-outlined">mail</span></a>
						</div>
					</div>
					<div className="public-footer-col">
						<h4>{m.footer_explore()}</h4>
						<Link to={localUrl("explorar")}>{m.footer_resources()}</Link>
						<Link to={localUrl("colecciones")}>{m.footer_collections()}</Link>
						<a href="#">{m.footer_communities()}</a>
						<a href="#">{m.footer_users()}</a>
					</div>
					<div className="public-footer-col">
						<h4>{m.footer_legal()}</h4>
						<a href="#">{m.footer_legal_notice()}</a>
						<a href="#">{m.footer_data_protection()}</a>
						<a href="#">{m.footer_accessibility()}</a>
					</div>
					<div className="public-footer-col">
						<h4>{m.footer_help()}</h4>
						<a href="/dev/">Panel de desarrollo</a>
						{HELP_FOOTER_LINKS.map((link) => (
							<Link key={link.sectionId} to={`/${buildHelpHref(link.sectionId)}`}>{link.label}</Link>
						))}
					</div>
				</div>
				<div className="public-footer-bottom">
					<p>{m.footer_copyright()}</p>
				</div>
			</footer>
		</>
	);
}
