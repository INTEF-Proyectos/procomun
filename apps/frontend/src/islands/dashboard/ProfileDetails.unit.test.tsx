import { describe, expect, test } from "bun:test";
import { EMPTY_PROFILE_DETAILS } from "@procomun/db/user-profile";
import { renderToStaticMarkup } from "react-dom/server";
import * as m from "../../paraglide/messages.js";
import {
	countryOptions,
	errorsByField,
	ProfileDetailsFields,
	ProfileDetailsView,
} from "./ProfileDetails.tsx";

const noop = () => {};

describe("ProfileDetailsFields (#533)", () => {
	test("pinta centro, localidad y redes con etiqueta y avisa de que son privados", () => {
		const html = renderToStaticMarkup(
			<ProfileDetailsFields
				value={{ ...EMPTY_PROFILE_DETAILS, locality: "Burgos" }}
				onChange={noop}
				errors={{}}
			/>,
		);
		expect(html).toContain("<fieldset");
		expect(html).toContain(m.profile_details_private_note());
		for (const id of [
			"profile-countryCode",
			"profile-locality",
			"profile-educationalCenter",
			"profile-educationalCenterUrl",
			"profile-website",
			"profile-facebook",
			"profile-twitter",
			"profile-linkedin",
		]) {
			expect(html).toContain(`for="${id}"`);
			expect(html).toContain(`id="${id}"`);
		}
		expect(html).toContain('value="Burgos"');
		expect(html).toContain('maxLength="255"');
		// Sin ocupación, estudios ni provincia (#494).
		expect(html).not.toMatch(/province|occupation|studies/i);
	});

	test("señala el campo con error y lo asocia a su mensaje", () => {
		const html = renderToStaticMarkup(
			<ProfileDetailsFields
				value={EMPTY_PROFILE_DETAILS}
				onChange={noop}
				errors={{ website: "invalid_url" }}
			/>,
		);
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain('aria-describedby="profile-website-error"');
		expect(html).toContain('id="profile-website-error"');
		expect(html).toContain(m.profile_error_invalid_url());
	});
});

describe("ProfileDetailsView (#533)", () => {
	test("lista solo los datos rellenos y no pinta nada si no hay ninguno", () => {
		expect(
			renderToStaticMarkup(
				<ProfileDetailsView details={EMPTY_PROFILE_DETAILS} />,
			),
		).toBe("");

		const html = renderToStaticMarkup(
			<ProfileDetailsView
				details={{
					...EMPTY_PROFILE_DETAILS,
					countryCode: "ES",
					educationalCenter: "CEIP Ejemplo",
					website: "https://ana.example/",
				}}
			/>,
		);
		expect(html).toContain("<dl");
		expect(html).toContain("CEIP Ejemplo");
		expect(html).toContain('href="https://ana.example/"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
		expect(html).toContain(m.profile_details_private_note());
		expect(html).not.toContain(m.profile_details_facebook());
	});
});

describe("utilidades del perfil ampliado (#533)", () => {
	test("los países salen con su nombre en el idioma y ordenados", () => {
		const options = countryOptions("es");
		expect(options).toHaveLength(249);
		expect(options.find((option) => option.code === "ES")?.name).toBe("España");
		const names = options.map((option) => option.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es")));
	});

	test("reparte los errores de la API por campo", () => {
		expect(
			errorsByField([
				{ field: "name", code: "required" },
				{ field: "profile.website", code: "invalid_url" },
			]),
		).toEqual({ name: "required", website: "invalid_url" });
	});
});
