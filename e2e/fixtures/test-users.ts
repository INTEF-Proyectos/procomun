/**
 * Test user credentials from seed data.
 * These users are created by `apps/cli/src/commands/seed.ts`.
 * Passwords are hashed at seed time — these are the plain-text values.
 */

export const TEST_USERS = {
	admin: {
		email: "admin@example.com",
		password: "password",
		name: "INTEF Oficial",
		role: "admin",
	},
	curator: {
		email: "curator@example.com",
		password: "password",
		name: "Ivonne Montesdeoca",
		role: "curator",
	},
	author: {
		email: "author@example.com",
		password: "password",
		name: "Yanira Mateos",
		role: "author",
	},
	reader: {
		email: "reader@example.com",
		password: "password",
		name: "Elisa Morales",
		role: "reader",
	},
} as const;

export type TestUserRole = keyof typeof TEST_USERS;
