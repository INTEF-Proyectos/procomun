import { HELP_FOOTER_LINKS, HELP_SECTIONS } from "../lib/help-content.ts";
import "../styles/help.css";

export default function AyudaPage() {
	return (
		<>
			<section className="help-hero">
				<div className="help-hero-copy">
					<p className="help-eyebrow">Centro de ayuda</p>
					<h1>Manual de uso de Procomun</h1>
					<p className="help-lead">
						Esta guia resume como descubrir recursos, publicar materiales, organizar colecciones y entender el flujo editorial
						de la plataforma.
					</p>
					<div className="help-hero-actions">
						<a href="#indice-ayuda" className="help-primary-link">Ir al indice</a>
						<a href="#contacto" className="help-secondary-link">Solicitar soporte</a>
					</div>
				</div>
				<aside className="help-hero-card" aria-label="Accesos rapidos de ayuda">
					<h2>Accesos rapidos</h2>
					<ul>
						{HELP_FOOTER_LINKS.map((link) => (
							<li key={link.sectionId}>
								<a href={`#${link.sectionId}`}>{link.label}</a>
							</li>
						))}
					</ul>
				</aside>
			</section>

			<section className="help-shell">
				<nav id="indice-ayuda" className="help-index" aria-label="Indice de ayuda">
					<h2>Indice</h2>
					<ol>
						{HELP_SECTIONS.map((section) => (
							<li key={section.id}>
								<a href={`#${section.id}`}>{section.title}</a>
							</li>
						))}
					</ol>
				</nav>

				<div className="help-sections">
					{HELP_SECTIONS.map((section) => (
						<article key={section.id} id={section.id} className="help-section" aria-labelledby={`${section.id}-title`}>
							<div className="help-section-head">
								<span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
								<div>
									<p className="help-section-eyebrow">{section.eyebrow}</p>
									<h2 id={`${section.id}-title`}>{section.title}</h2>
								</div>
							</div>
							<p className="help-section-description">{section.description}</p>
							<ul className="help-section-list">
								{section.items.map((item, i) => (
									<li key={i}>{item}</li>
								))}
							</ul>
						</article>
					))}
				</div>
			</section>
		</>
	);
}
