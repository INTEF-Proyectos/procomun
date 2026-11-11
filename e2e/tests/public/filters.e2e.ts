import { expect, test } from "@playwright/test";
import { FILTERS } from "../../fixtures/test-data";

test.describe("Search filters", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/explorar");
	});

	test("filter by resource type", async ({ page }) => {
		const typeFilter = page
			.getByRole("combobox", { name: /tipo/i })
			.or(page.getByLabel(/tipo/i));
		if (await typeFilter.isVisible()) {
			await selectOptionMatching(typeFilter, FILTERS.resourceType);
			await expect(page.locator("body")).not.toHaveText(/error/i);
		}
	});

	test("filter by level", async ({ page }) => {
		const levelFilter = page
			.getByRole("combobox", { name: /nivel/i })
			.or(page.getByLabel(/nivel/i));
		if (await levelFilter.isVisible()) {
			await selectOptionMatching(levelFilter, FILTERS.level);
			await expect(page.locator("body")).not.toHaveText(/error/i);
		}
	});

	test("filter by language", async ({ page }) => {
		const langFilter = page
			.getByRole("combobox", { name: /idioma|lengua/i })
			.or(page.getByLabel(/idioma|lengua/i));
		if (await langFilter.isVisible()) {
			await selectOptionMatching(langFilter, FILTERS.language);
			await expect(page.locator("body")).not.toHaveText(/error/i);
		}
	});

	// #448: varias áreas a la vez, cada una se quita por separado.
	test("filter by knowledge area", async ({ page }) => {
		const search = page.getByRole("combobox", { name: "Buscar un área" });
		await search.fill("ingles");
		await page.getByRole("option", { name: "Inglés" }).click();
		await expect(page).toHaveURL(/knowledgeAreas=ingles/);
		await search.fill("quimica");
		await search.press("ArrowDown");
		await search.press("Enter");
		await expect(page).toHaveURL(/knowledgeAreas=ingles%2Cquimica/);

		await page.getByRole("button", { name: "Quitar Inglés" }).click();
		await expect(page).toHaveURL(/knowledgeAreas=quimica/);
		await expect(page).not.toHaveURL(/ingles/);
		await expect(page.locator("body")).not.toHaveText(/error/i);
	});

	test("the professional family filter only appears with FP", async ({
		page,
	}) => {
		const familySearch = page.getByRole("combobox", {
			name: "Buscar una familia",
		});
		await expect(familySearch).toHaveCount(0);
		await page
			.getByLabel("Etapa, programa o ámbito educativo")
			.selectOption({ label: "Formación Profesional" });
		await familySearch.fill("sanidad");
		await page.getByRole("option", { name: "Sanidad" }).click();
		await expect(page).toHaveURL(/professionalFamilies=sanidad/);

		await page
			.getByLabel("Etapa, programa o ámbito educativo")
			.selectOption({ label: "Todas" });
		await expect(familySearch).toHaveCount(0);
		await expect(page).not.toHaveURL(/professionalFamilies/);
	});

	test("filter by license", async ({ page }) => {
		const licenseFilter = page
			.getByRole("combobox", { name: /licencia/i })
			.or(page.getByLabel(/licencia/i));
		if (await licenseFilter.isVisible()) {
			await selectOptionMatching(licenseFilter, FILTERS.license);
			await expect(page.locator("body")).not.toHaveText(/error/i);
		}
	});
});

/**
 * Playwright's selectOption({ label }) only accepts a string label, not RegExp.
 * Match case-insensitively against option text, then select by the resolved label.
 */
async function selectOptionMatching(
	select: import("@playwright/test").Locator,
	pattern: string,
) {
	const labels = await select.locator("option").allTextContents();
	const matcher = new RegExp(pattern, "i");
	const match = labels
		.map((label) => label.trim())
		.find((label) => matcher.test(label));
	if (!match) {
		throw new Error(`No option matching /${pattern}/i in select`);
	}
	await select.selectOption({ label: match });
}
