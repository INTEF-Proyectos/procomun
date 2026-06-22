import { expect, test } from '@playwright/test';
import { FILTERS } from '../../fixtures/test-data';

test.describe('Search filters', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/explorar');
	});

	test('filter by resource type', async ({ page }) => {
		const typeFilter = page.getByRole('combobox', { name: /tipo/i }).or(
			page.getByLabel(/tipo/i)
		);
		if (await typeFilter.isVisible()) {
			await typeFilter.selectOption({ label: new RegExp(FILTERS.resourceType, 'i') });
			await expect(page.locator('body')).not.toHaveText(/error/i);
		}
	});

	test('filter by level', async ({ page }) => {
		const levelFilter = page.getByRole('combobox', { name: /nivel/i }).or(
			page.getByLabel(/nivel/i)
		);
		if (await levelFilter.isVisible()) {
			await levelFilter.selectOption({ label: new RegExp(FILTERS.level, 'i') });
			await expect(page.locator('body')).not.toHaveText(/error/i);
		}
	});

	test('filter by language', async ({ page }) => {
		const langFilter = page.getByRole('combobox', { name: /idioma|lengua/i }).or(
			page.getByLabel(/idioma|lengua/i)
		);
		if (await langFilter.isVisible()) {
			await langFilter.selectOption({ label: new RegExp(FILTERS.language, 'i') });
			await expect(page.locator('body')).not.toHaveText(/error/i);
		}
	});

	test('filter by license', async ({ page }) => {
		const licenseFilter = page.getByRole('combobox', { name: /licencia/i }).or(
			page.getByLabel(/licencia/i)
		);
		if (await licenseFilter.isVisible()) {
			await licenseFilter.selectOption({ label: new RegExp(FILTERS.license, 'i') });
			await expect(page.locator('body')).not.toHaveText(/error/i);
		}
	});
});
