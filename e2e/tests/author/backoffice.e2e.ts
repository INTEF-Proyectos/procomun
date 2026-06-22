import { expect, test } from '@playwright/test';
import { loginAs } from '../../utils/auth';

test.describe('Author - Backoffice access', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'author');
	});

	test('can access profile or backoffice area', async ({ page }) => {
		await page.goto('/perfil');
		await expect(page.getByRole('heading').first()).toBeVisible();
	});

	test('can see "my resources" section', async ({ page }) => {
		await page.goto('/perfil');
		const myResources = page.getByText(/mis recursos|my resources/i).or(
			page.getByRole('link', { name: /mis recursos/i })
		);
		await expect(myResources.first()).toBeVisible();
	});
});

test.describe('Author - Create resource', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'author');
	});

	test('can access new resource form', async ({ page }) => {
		await page.goto('/nuevo');
		await expect(page.getByRole('heading', { name: /nuevo|crear|new/i })).toBeVisible();
	});

	test.fixme('can fill and submit basic resource form', async ({ page }) => {
		// The /nuevo flow starts by uploading an .elpx (eXeLearning) package
		// rather than filling a plain title/description form, so there is no
		// title field to fill yet. Revisit once a metadata-first creation form
		// (or an .elpx fixture upload) is available in the UI.
		await page.goto('/nuevo');

		const titleInput = page.getByLabel(/título|title/i);
		await titleInput.fill('E2E Test Resource');

		const descInput = page.getByLabel(/descripción|description/i);
		if (await descInput.isVisible()) {
			await descInput.fill('Resource created by E2E test');
		}

		const submitBtn = page.getByRole('button', { name: /guardar|crear|save|create/i });
		if (await submitBtn.isVisible()) {
			await submitBtn.click();
			await expect(page.getByText(/creado|guardado|saved|created|éxito/i).or(
				page.locator('[data-testid="success-message"]')
			)).toBeVisible({ timeout: 10000 });
		}
	});
});

test.describe('Author - Edit resource', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'author');
	});

	test.fixme('can edit an existing resource', async ({ page }) => {
		// TODO: Implement when edit route is connected to author's resources.
		// Need to navigate to author's own resource and click edit.
		await page.goto('/perfil');
		const editLink = page.getByRole('link', { name: /editar|edit/i }).first();
		await editLink.click();
		await expect(page.getByLabel(/título|title/i)).toBeVisible();
	});
});

test.describe('Author - Change resource status', () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, 'author');
	});

	test.fixme('can submit resource for review (draft → review)', async ({ page }) => {
		// TODO: Implement when status change workflow is fully available in UI.
		await page.goto('/perfil');
		// Find a draft resource and submit for review
		const submitReviewBtn = page.getByRole('button', { name: /enviar.*revisión|submit.*review/i });
		await expect(submitReviewBtn).toBeVisible();
	});
});

test.describe('Author - File upload', () => {
	test.fixme('can upload a file via TUS', async ({ page }) => {
		// TODO: Implement when TUS upload is fully wired in the UI.
		// Use a small fixture file for upload testing.
		await page.goto('/nuevo');
		const fileInput = page.getByLabel(/archivo|file|subir/i);
		await expect(fileInput).toBeVisible();
	});
});
