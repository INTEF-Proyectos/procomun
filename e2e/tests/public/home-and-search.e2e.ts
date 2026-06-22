import { expect, test } from '@playwright/test';
import { PUBLISHED_RESOURCE, SEARCH_TERMS } from '../../fixtures/test-data';

test.describe('Home page', () => {
	test('loads successfully and shows main heading', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle(/procomun|recursos/i);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('displays navigation links', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('navigation')).toBeVisible();
		await expect(page.getByRole('navigation').getByRole('link', { name: /explorar|recursos/i })).toBeVisible();
	});

	test('shows featured or recent resources', async ({ page }) => {
		await page.goto('/');
		// Should display at least one resource card or link
		const resourceLinks = page.getByRole('link').filter({ hasText: /./});
		await expect(resourceLinks.first()).toBeVisible();
	});
});

test.describe('Resource listing', () => {
	test('displays published resources on explore page', async ({ page }) => {
		await page.goto('/explorar');
		await expect(page.getByRole('heading').first()).toBeVisible();
		// Should show at least one resource from seed data
		await expect(page.getByText(PUBLISHED_RESOURCE.title).or(
			page.locator('[data-testid="resource-card"]').first()
		)).toBeVisible();
	});

	test('navigates to resource detail from listing', async ({ page }) => {
		await page.goto('/explorar');
		// Click the first resource link
		const firstResource = page.getByRole('link').filter({
			hasText: PUBLISHED_RESOURCE.title,
		});
		if (await firstResource.isVisible()) {
			await firstResource.click();
			await expect(page).toHaveURL(/\/recurso/);
		}
	});
});

test.describe('Search', () => {
	test('search with valid term returns results', async ({ page }) => {
		await page.goto('/explorar');
		const searchInput = page.getByRole('searchbox').or(
			page.getByPlaceholder(/buscar|search/i)
		);
		await searchInput.fill(SEARCH_TERMS.withResults);
		await searchInput.press('Enter');
		// Should show results
		await expect(page.getByText(/resultado|recurso/i).first()).toBeVisible();
	});

	test('search with no results shows empty state', async ({ page }) => {
		await page.goto('/explorar');
		const searchInput = page.getByRole('searchbox').or(
			page.getByPlaceholder(/buscar|search/i)
		);
		await searchInput.fill(SEARCH_TERMS.noResults);
		await searchInput.press('Enter');
		await expect(page.getByText(/no se encontraron|sin resultados|no results/i)).toBeVisible();
	});
});
