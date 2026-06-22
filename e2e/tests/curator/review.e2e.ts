import { expect, test } from '@playwright/test';
import { loginAs } from '../../utils/auth';

test.describe('Curator - Review resources', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'curator');
	});

	test('can access admin panel', async ({ page }) => {
		await page.goto('/admin');
		await expect(page.getByRole('heading').first()).toBeVisible();
	});

	test.fixme('can see resources pending review', async ({ page }) => {
		// TODO: Implement when curator review queue UI is available.
		await page.goto('/admin');
		const pendingSection = page.getByText(/pendientes|revisión|review/i);
		await expect(pendingSection).toBeVisible();
	});

	test.fixme('can publish a resource (review → published)', async ({ page }) => {
		// TODO: Implement when publish action is wired in admin panel.
		await page.goto('/admin');
		const publishBtn = page.getByRole('button', { name: /publicar|publish/i });
		await expect(publishBtn).toBeVisible();
	});

	test.fixme('can archive a resource', async ({ page }) => {
		// TODO: Implement when archive action is available.
		await page.goto('/admin');
		const archiveBtn = page.getByRole('button', { name: /archivar|archive/i });
		await expect(archiveBtn).toBeVisible();
	});
});

test.describe('Curator - Collections management', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'curator');
	});

	test.fixme('can create a new collection', async ({ page }) => {
		// TODO: Implement when collection CRUD is available in admin panel.
		await page.goto('/admin');
		const newCollectionBtn = page.getByRole('link', { name: /nueva colección|new collection/i }).or(
			page.getByRole('button', { name: /nueva colección|new collection/i })
		);
		await expect(newCollectionBtn).toBeVisible();
	});

	test.fixme('can edit a collection', async ({ page }) => {
		// TODO: Implement when collection edit UI is available.
		await page.goto('/admin');
		const editBtn = page.getByRole('link', { name: /editar/i }).first();
		await expect(editBtn).toBeVisible();
	});

	test.fixme('can reorder resources in a collection', async ({ page }) => {
		// TODO: Implement when drag-and-drop reorder is available.
		await page.goto('/admin');
	});
});
