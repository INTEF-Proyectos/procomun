import { type Page, expect } from '@playwright/test';
import { TEST_USERS, type TestUserRole } from '../fixtures/test-users';

/**
 * Login via the UI login form.
 * Waits for navigation to complete after successful login.
 */
export async function loginAs(page: Page, role: TestUserRole) {
	const user = TEST_USERS[role];
	await page.goto('/login');
	// Scope to the login form: the public footer also exposes a "Correo" link,
	// so an unscoped getByLabel(/email|correo/i) matches two elements.
	const form = page.locator('form.login-form');
	await form.getByLabel(/email|correo/i).fill(user.email);
	await form.getByLabel(/contraseña|password/i).fill(user.password);
	await page.getByRole('button', { name: /iniciar sesión|login|entrar/i }).click();
	// Wait for redirect away from login page
	await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Logout via the UI.
 */
export async function logout(page: Page) {
	// Look for a user menu or logout button
	const userMenu = page.getByRole('button', { name: /perfil|usuario|menú/i });
	if (await userMenu.isVisible()) {
		await userMenu.click();
	}
	await page.getByRole('link', { name: /cerrar sesión|logout|salir/i }).or(
		page.getByRole('button', { name: /cerrar sesión|logout|salir/i })
	).click();
	await expect(page).toHaveURL(/\/(login)?$/);
}
