import { expect, test } from '@playwright/test';

test.describe('Internationalization (i18n)', () => {
	test('default page loads in Spanish', async ({ page }) => {
		await page.goto('/');
		// Default locale should be Spanish — check for Spanish content
		await expect(page.locator('html')).toHaveAttribute('lang', /es/);
	});

	test('can switch to English locale', async ({ page }) => {
		await page.goto('/en');
		await expect(page.locator('html')).toHaveAttribute('lang', /en/);
	});

	test('can switch to Catalan locale', async ({ page }) => {
		await page.goto('/ca');
		await expect(page.locator('html')).toHaveAttribute('lang', /ca/);
	});

	test('can switch to Galician locale', async ({ page }) => {
		await page.goto('/gl');
		await expect(page.locator('html')).toHaveAttribute('lang', /gl/);
	});

	test('can switch to Basque locale', async ({ page }) => {
		await page.goto('/eu');
		await expect(page.locator('html')).toHaveAttribute('lang', /eu/);
	});
});
