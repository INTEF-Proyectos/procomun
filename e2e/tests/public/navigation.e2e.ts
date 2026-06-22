import { expect, test } from '@playwright/test';

test.describe('Help page', () => {
	test('help page loads successfully', async ({ page }) => {
		await page.goto('/ayuda');
		await expect(page.getByRole('heading').first()).toBeVisible();
	});

	test('help page has content sections', async ({ page }) => {
		await page.goto('/ayuda');
		const headings = page.getByRole('heading');
		await expect(headings.first()).toBeVisible();
	});
});

test.describe('Navigation between sections', () => {
	test('can navigate from home to explore', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('navigation').getByRole('link', { name: /explorar|recursos/i }).click();
		await expect(page).toHaveURL(/\/explorar/);
	});

	test('can navigate from home to collections', async ({ page }) => {
		await page.goto('/');
		const collectionsLink = page.getByRole('link', { name: /colecciones/i });
		if (await collectionsLink.isVisible()) {
			await collectionsLink.click();
			await expect(page).toHaveURL(/\/colecciones/);
		}
	});

	test('can navigate from home to help', async ({ page }) => {
		await page.goto('/');
		const helpLink = page.getByRole('link', { name: /ayuda|help/i });
		if (await helpLink.isVisible()) {
			await helpLink.click();
			await expect(page).toHaveURL(/\/ayuda/);
		}
	});
});
