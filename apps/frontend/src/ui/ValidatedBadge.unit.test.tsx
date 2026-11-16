import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceCard } from "./ResourceCard.tsx";
import { ValidatedBadge, ValidatedEditWarning } from "./ValidatedBadge.tsx";

// Issue #420: sello «Validado» en la ficha y en las tarjetas.

const PUBLISHED = {
	editorialStatus: "published",
	validatedAt: "2026-11-16T10:00:00.000Z",
	validationSource: "review",
};

describe("ValidatedBadge", () => {
	test("muestra «Validado» con texto, no solo con el icono", () => {
		const html = renderToStaticMarkup(<ValidatedBadge resource={PUBLISHED} />);
		expect(html).toContain("Validado");
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("verified");
	});

	test("no sale sin sello ni en un recurso que no está publicado", () => {
		expect(
			renderToStaticMarkup(
				<ValidatedBadge
					resource={{ editorialStatus: "published", validatedAt: null }}
				/>,
			),
		).toBe("");
		expect(
			renderToStaticMarkup(
				<ValidatedBadge
					resource={{ ...PUBLISHED, editorialStatus: "archived" }}
				/>,
			),
		).toBe("");
	});

	test("en la ficha explica qué significa y da la fecha", () => {
		const html = renderToStaticMarkup(
			<ValidatedBadge
				resource={PUBLISHED}
				variant="detail"
				dateLabel="16 de noviembre de 2026"
			/>,
		);
		expect(html).toContain("Revisado por el equipo de curación de Procomún");
		expect(html).toContain("16 de noviembre de 2026");
		expect(html.toLowerCase()).toContain('datetime="2026-11-16t10:00:00.000z"');
	});

	test("en los importados no da fecha: es la del Procomún antiguo", () => {
		const html = renderToStaticMarkup(
			<ValidatedBadge
				resource={{ ...PUBLISHED, validationSource: "legacy" }}
				variant="detail"
				dateLabel="16 de noviembre de 2026"
			/>,
		);
		expect(html).toContain("Revisado por el equipo de curación de Procomún");
		expect(html).not.toContain("16 de noviembre de 2026");
	});
});

describe("ResourceCard con sello", () => {
	const BASE = {
		id: "r1",
		slug: "r1",
		title: "Recurso",
		description: "Descripción",
		resourceType: "documento",
		language: "es",
		license: "cc-by",
		editorialStatus: "published",
		createdAt: "",
	};

	test("la tarjeta de un recurso validado lleva el sello", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=r1"
				resource={{ ...BASE, validatedAt: PUBLISHED.validatedAt }}
			/>,
		);
		expect(html).toContain("Validado");
	});

	test("la de uno sin validar, no", () => {
		const html = renderToStaticMarkup(
			<ResourceCard href="/recurso?slug=r1" resource={BASE} />,
		);
		expect(html).not.toContain("Validado");
	});
});

describe("ValidatedEditWarning", () => {
	test("avisa al autor de que perderá el sello si guarda cambios", () => {
		for (const role of ["author", "editor"]) {
			const html = renderToStaticMarkup(
				<ValidatedEditWarning resource={PUBLISHED} userRole={role} />,
			);
			expect(html).toContain("perderá");
			expect(html).toContain('role="note"');
		}
	});

	test("no avisa a curator ni admin, ni si el recurso no tiene sello", () => {
		for (const role of ["curator", "admin"]) {
			expect(
				renderToStaticMarkup(
					<ValidatedEditWarning resource={PUBLISHED} userRole={role} />,
				),
			).toBe("");
		}
		expect(
			renderToStaticMarkup(
				<ValidatedEditWarning
					resource={{ ...PUBLISHED, validatedAt: null }}
					userRole="author"
				/>,
			),
		).toBe("");
	});
});
