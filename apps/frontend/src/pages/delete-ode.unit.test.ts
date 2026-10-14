import { describe, expect, test } from "bun:test";
import {
	canShowDeleteOdeButton,
	DELETE_ODE_BUTTON_LABEL,
	deleteOdeConfirmationMessage,
} from "./delete-ode.ts";

describe("Borrar ODE en la pantalla de edición (issue #393)", () => {
	test("el botón se llama exactamente «Borrar ODE»", () => {
		expect(DELETE_ODE_BUTTON_LABEL).toBe("Borrar ODE");
	});

	test("solo se muestra con permiso de edición y con un ODE presente", () => {
		expect(canShowDeleteOdeButton({ role: "reader", hasOde: true })).toBe(
			false,
		);
		expect(canShowDeleteOdeButton({ role: "author", hasOde: false })).toBe(
			false,
		);
		expect(canShowDeleteOdeButton({ role: null, hasOde: true })).toBe(false);
		expect(canShowDeleteOdeButton({ role: "author", hasOde: true })).toBe(true);
		expect(canShowDeleteOdeButton({ role: "editor", hasOde: true })).toBe(true);
		expect(canShowDeleteOdeButton({ role: "curator", hasOde: true })).toBe(
			true,
		);
		expect(canShowDeleteOdeButton({ role: "admin", hasOde: true })).toBe(true);
	});

	test("la confirmación nombra el archivo del ODE", () => {
		const message = deleteOdeConfirmationMessage({
			originalFilename: "fracciones.elpx",
			resourceTitle: "Otro título",
		});
		expect(message).toContain("fracciones.elpx");
		expect(message).not.toContain("Otro título");
	});

	test("la confirmación usa el título del recurso si no hay nombre de archivo", () => {
		expect(
			deleteOdeConfirmationMessage({
				originalFilename: "  ",
				resourceTitle: "Fracciones visuales",
			}),
		).toContain("Fracciones visuales");
		expect(
			deleteOdeConfirmationMessage({
				originalFilename: null,
				resourceTitle: "Fracciones visuales",
			}),
		).toContain("Fracciones visuales");
	});
});
