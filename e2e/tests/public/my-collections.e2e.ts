import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

async function collectionsForOwner(
	page: Page,
	role: "author" | "editor",
	hasCollection = true,
) {
	await loginAs(page, role);
	const session = await (
		await page.request.get("/api/auth/get-session")
	).json();

	// El seed público no contiene itinerarios importados de la cuenta autora.
	// Se representa aquí la respuesta correspondiente al propietario importado.
	let collection = {
		id: "legacy-itinerary",
		slug: "itinerario-importado",
		title: "Itinerario importado",
		description: "Descripción original",
		editorialStatus: "draft",
		curatorId: session.user.id,
		isOrdered: 1,
		language: "es",
	};
	await page.route(/\/api\/admin\/collections(?:\?|$)/, (route) =>
		route.fulfill({
			json: {
				data: hasCollection ? [collection] : [],
				total: hasCollection ? 1 : 0,
				offset: 0,
			},
		}),
	);
	let linked: { resourceId: string; title: string; editorialStatus: string }[] =
		[];
	await page.route(
		"**/api/admin/collections/legacy-itinerary/resources",
		async (route) => {
			if (route.request().method() === "POST") {
				linked = [
					{
						resourceId: route.request().postDataJSON().resourceId,
						title: "Introducción a la Programación con Scratch",
						editorialStatus: "published",
					},
				];
				await route.fulfill({ status: 201, json: { ok: true } });
				return;
			}
			await route.fulfill({ json: linked });
		},
	);
	await page.route(
		"**/api/admin/collections/legacy-itinerary/resources/*",
		async (route) => {
			linked = [];
			await route.fulfill({ json: { ok: true } });
		},
	);

	await page.route(
		"**/api/admin/collections/legacy-itinerary",
		async (route) => {
			if (route.request().method() === "PATCH") {
				collection = { ...collection, ...route.request().postDataJSON() };
				await route.fulfill({ json: { ok: true } });
				return;
			}
			await route.fulfill({ json: collection });
		},
	);
}

for (const role of ["author", "editor"] as const) {
	test(`el propietario ${role} puede editar y enviar a revisión desde su perfil`, async ({
		page,
	}) => {
		await collectionsForOwner(page, role);
		await page.goto("/perfil?tab=collections");

		await expect(
			page.getByRole("tab", { name: "Mis colecciones" }),
		).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("button", { name: /crear colecci[oó]n|eliminar/i }),
		).toHaveCount(0);
		await page
			.getByRole("button", { name: "Editar Itinerario importado" })
			.click();

		const dialog = page.getByRole("dialog", { name: "Editar colección" });
		await expect(dialog).toBeVisible();
		// Por nombre accesible: el diálogo puede tener otros selectores (#623).
		await expect(dialog.getByRole("combobox", { name: "Estado" })).toHaveCount(
			0,
		);
		await dialog
			.getByLabel("Título", { exact: true })
			.fill("Itinerario actualizado");
		await dialog.getByLabel("Idioma", { exact: true }).selectOption("ca");
		const save = page.waitForRequest(
			(request) =>
				request.method() === "PATCH" &&
				request.url().endsWith("/legacy-itinerary"),
		);
		await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
		expect((await save).postDataJSON()).toEqual({
			title: "Itinerario actualizado",
			language: "ca",
		});
		const edit = page.getByRole("button", {
			name: "Editar Itinerario actualizado",
		});
		await expect(edit).toBeVisible();

		await edit.click();
		await expect(dialog.getByLabel("Idioma", { exact: true })).toHaveValue(
			"ca",
		);
		const patch = page.waitForRequest(
			(request) =>
				request.method() === "PATCH" &&
				request.url().endsWith("/legacy-itinerary"),
		);
		await dialog.getByRole("button", { name: "Enviar a revisión" }).click();
		expect((await patch).postDataJSON()).toEqual({
			editorialStatus: "review",
		});
		await expect(dialog).toHaveCount(0);
		await edit.click();
		await expect(
			dialog.getByRole("button", { name: "Enviar a revisión" }),
		).toHaveCount(0);
	});
}

test("el editor añade y quita un recurso publicado desde la colección", async ({
	page,
}) => {
	await collectionsForOwner(page, "editor");
	await page.goto("/perfil?tab=collections");
	await page
		.getByRole("button", { name: "Editar Itinerario importado" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Editar colección" });
	const search = dialog.getByRole("searchbox", { name: "Buscar recursos" });
	await search.fill("Scratch");
	await search.press("Enter");
	const rows = dialog.getByRole("row", {
		name: /Introducción a la Programación con Scratch/i,
	});
	await rows.getByRole("button", { name: "Añadir" }).click();
	await expect(rows.getByRole("button", { name: "Añadir" })).toHaveCount(0);
	await rows.getByRole("button", { name: "Quitar" }).click();
	await expect(rows.getByRole("button", { name: "Quitar" })).toHaveCount(0);
	await expect(rows.getByRole("button", { name: "Añadir" })).toBeVisible();
});

test("un editor sin colecciones ve la pestaña con un aviso", async ({
	page,
}) => {
	await collectionsForOwner(page, "editor", false);
	await page.goto("/perfil?tab=collections");
	await expect(
		page.getByRole("tab", { name: "Mis colecciones" }),
	).toHaveAttribute("aria-selected", "true");
	await expect(
		page.getByText("Todavía no tienes colecciones.", { exact: false }),
	).toBeVisible();
});

for (const role of ["curator", "admin"] as const) {
	test(`${role} conserva la creación en el backoffice`, async ({ page }) => {
		await loginAs(page, role);
		await page.goto("/admin?section=collections");
		await expect(
			page.getByRole("button", { name: /Crear coleccion/i }),
		).toBeVisible();
	});
}
