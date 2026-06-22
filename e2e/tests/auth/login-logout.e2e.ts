import { expect, test } from '@playwright/test';
import { TEST_USERS } from '../../fixtures/test-users';

test.describe('Login', () => {
	test('login page loads', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByRole('heading', { name: /iniciar sesión|login|acceder/i })).toBeVisible();
		// Scope to the login form — the public footer also exposes a "Correo" link.
		const form = page.locator('form.login-form');
		await expect(form.getByLabel(/email|correo/i)).toBeVisible();
		await expect(form.getByLabel(/contraseña|password/i)).toBeVisible();
	});

	test('successful login redirects away from login page', async ({ page }) => {
		const user = TEST_USERS.author;
		await page.goto('/login');
		const form = page.locator('form.login-form');
		await form.getByLabel(/email|correo/i).fill(user.email);
		await form.getByLabel(/contraseña|password/i).fill(user.password);
		await page.getByRole('button', { name: /iniciar sesión|login|entrar/i }).click();
		await expect(page).not.toHaveURL(/\/login/);
	});

	test('shows error with invalid credentials', async ({ page }) => {
		await page.goto('/login');
		const form = page.locator('form.login-form');
		await form.getByLabel(/email|correo/i).fill('invalid@example.com');
		await form.getByLabel(/contraseña|password/i).fill('wrongpassword');
		await page.getByRole('button', { name: /iniciar sesión|login|entrar/i }).click();
		await expect(page.getByText(/error|inválid|incorrect|no válid/i)).toBeVisible();
	});

	test('shows error with empty fields', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('button', { name: /iniciar sesión|login|entrar/i }).click();
		// Should show validation or remain on login
		await expect(page).toHaveURL(/\/login/);
	});
});

test.describe('Logout', () => {
	test('user can logout after login', async ({ page }) => {
		const user = TEST_USERS.author;
		await page.goto('/login');
		const form = page.locator('form.login-form');
		await form.getByLabel(/email|correo/i).fill(user.email);
		await form.getByLabel(/contraseña|password/i).fill(user.password);
		await page.getByRole('button', { name: /iniciar sesión|login|entrar/i }).click();
		await expect(page).not.toHaveURL(/\/login/);

		// Open the user menu (button labelled "Menú de <name>") and click the
		// logout entry, which is rendered as a dropdown menuitem.
		await page.getByRole('button', { name: /menú de|usuario|cuenta/i }).first().click();
		await page.getByRole('menuitem', { name: /cerrar sesión|logout|salir/i }).click();
		// Should be redirected to home or login
		await expect(page).toHaveURL(/\/(login)?$/);
	});
});

test.describe('Registration', () => {
	test('registration page loads', async ({ page }) => {
		await page.goto('/registro');
		await expect(page.getByRole('heading', { name: /registro|registrarse|crear cuenta/i })).toBeVisible();
	});

	test.fixme('can register a new user', async ({ page }) => {
		// TODO: Implement when registration flow is fully working.
		// Needs unique email generation and cleanup strategy.
		await page.goto('/registro');
		await page.getByLabel(/nombre/i).fill('Test User E2E');
		await page.getByLabel(/email|correo/i).fill(`e2e-test-${Date.now()}@example.com`);
		await page.getByLabel(/contraseña|password/i).fill('SecurePass123!');
		await page.getByRole('button', { name: /registrarse|crear cuenta|registro/i }).click();
		await expect(page).not.toHaveURL(/\/registro/);
	});
});

test.describe('Password recovery', () => {
	test.fixme('password recovery page exists', async ({ page }) => {
		// TODO: Implement when password recovery flow is available in the UI.
		await page.goto('/login');
		const forgotLink = page.getByRole('link', { name: /olvidé|recuperar|forgot/i });
		await expect(forgotLink).toBeVisible();
	});
});
