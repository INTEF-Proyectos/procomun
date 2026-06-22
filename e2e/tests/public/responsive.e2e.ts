import { expect, test } from '@playwright/test';

test.describe('Responsive - Mobile', () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test('home page renders correctly on mobile', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('navigation is accessible on mobile (hamburger menu or similar)', async ({ page }) => {
		await page.goto('/');
		// On mobile, navigation may be behind a hamburger button
		const menuButton = page.getByRole('button', { name: /menú|menu/i });
		const nav = page.getByRole('navigation');
		if (await menuButton.isVisible()) {
			await menuButton.click();
			await expect(nav).toBeVisible();
		} else {
			await expect(nav).toBeVisible();
		}
	});
});

test.describe('Responsive - Tablet', () => {
	test.use({ viewport: { width: 768, height: 1024 } });

	test('home page renders correctly on tablet', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('explore page works on tablet', async ({ page }) => {
		await page.goto('/explorar');
		await expect(page.getByRole('heading').first()).toBeVisible();
	});
});

test.describe('Responsive - Desktop', () => {
	test.use({ viewport: { width: 1920, height: 1080 } });

	test('home page renders correctly on desktop', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('full navigation visible on desktop', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('navigation')).toBeVisible();
	});
});
