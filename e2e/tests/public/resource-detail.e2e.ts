import { expect, test } from '@playwright/test';
import { PUBLISHED_RESOURCE } from '../../fixtures/test-data';

test.describe('Resource detail page', () => {
	test('displays resource metadata', async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await expect(page.getByRole('heading', { name: new RegExp(PUBLISHED_RESOURCE.title, 'i') })).toBeVisible();
	});

	test('shows resource description', async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		// Resource should have a description visible
		const mainContent = page.getByRole('main').or(page.locator('article'));
		await expect(mainContent).toBeVisible();
	});

	test('shows resource metadata fields', async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		// Should show metadata like license, type, level, etc. The license is
		// rendered as its slug (e.g. "cc-by-nc-sa"), hence the cc-by matcher.
		await expect(page.getByText(/licencia|license|cc-by/i).or(
			page.getByText(/CC BY/i)
		).first()).toBeVisible();
	});

	test('has working back navigation', async ({ page }) => {
		await page.goto('/explorar');
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await page.goBack();
		await expect(page).toHaveURL(/\/explorar/);
	});
});
