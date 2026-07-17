import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";
import { loginAs } from "../../utils/auth";

/**
 * @axe-core/playwright tipa `page` contra `playwright-core`, que puede
 * resolverse a un parche distinto de `@playwright/test` (1.61.0 vs 1.61.1).
 * Estructuralmente es el mismo Page; este helper aísla el puente de tipos.
 */
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

function analyzePage(page: Page) {
	// Puente entre las dos copias de tipos de playwright-core (mismo API).
	return new AxeBuilder({ page: page as unknown as AxePage })
		.withTags(["wcag2a", "wcag2aa"])
		.analyze();
}

async function expectNoCriticalA11yViolations(page: Page) {
	const results = await analyzePage(page);
	const critical = results.violations.filter(
		(v) => v.impact === "critical" || v.impact === "serious",
	);
	expect(critical).toEqual([]);
}

test.describe("Accessibility - Public pages", () => {
	test("home page has no critical accessibility violations", async ({
		page,
	}) => {
		await page.goto("/");
		await expectNoCriticalA11yViolations(page);
	});

	test("explore page has no critical accessibility violations", async ({
		page,
	}) => {
		await page.goto("/explorar");
		await expectNoCriticalA11yViolations(page);
	});

	test("resource detail page has no critical accessibility violations", async ({
		page,
	}) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await expectNoCriticalA11yViolations(page);
	});

	test("login page has no critical accessibility violations", async ({
		page,
	}) => {
		await page.goto("/login");
		await expectNoCriticalA11yViolations(page);
	});
});

test.describe("Accessibility - Keyboard navigation", () => {
	test("can navigate home page with keyboard", async ({ page }) => {
		await page.goto("/");
		// Wait for the islands to hydrate so keyboard focus enters the page
		// reliably (otherwise Tab fires before the document is interactive).
		await page
			.getByRole("navigation")
			.getByRole("link")
			.first()
			.waitFor({ state: "visible" });
		// Tab through interactive elements - first Tab focuses the sr-only skip
		// link, the second reaches a visible control.
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");
		const focused = page.locator(":focus");
		await expect(focused).toBeVisible();
	});

	test("focus is visible on interactive elements", async ({ page }) => {
		await page.goto("/");
		// Wait for hydration before driving the keyboard (see test above).
		await page
			.getByRole("navigation")
			.getByRole("link")
			.first()
			.waitFor({ state: "visible" });
		// Tab past the sr-only skip-to-content link
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");
		// Focused element should have visible focus indicator
		const focused = page.locator(":focus");
		await expect(focused).toBeVisible();
	});

	test("navigation landmarks exist on home page", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("navigation")).toBeVisible();
		await expect(page.getByRole("main").or(page.locator("main"))).toBeVisible();
	});

	test("headings follow correct hierarchy", async ({ page }) => {
		await page.goto("/");
		const h1 = page.getByRole("heading", { level: 1 });
		await expect(h1).toBeVisible();
		// Page should have exactly one h1
		await expect(h1).toHaveCount(1);
	});
});

test.describe("Accessibility - Authenticated pages", () => {
	test("new resource form has no critical violations", async ({ page }) => {
		await loginAs(page, "author");
		await page.goto("/nuevo");
		await expectNoCriticalA11yViolations(page);
	});

	test("admin panel has no critical violations", async ({ page }) => {
		await loginAs(page, "admin");
		await page.goto("/admin");
		await expectNoCriticalA11yViolations(page);
	});
});
