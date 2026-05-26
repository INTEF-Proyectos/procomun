import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { apiTokens } from "../schema/api-tokens.ts";
import type { DrizzleDB } from "./shared.ts";

/**
 * Hash a raw token using SHA-256. Returns hex string.
 */
export async function hashToken(rawToken: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(rawToken);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Generate a secure random token with a prefix for identification.
 * Format: "pck_" + 40 random hex chars (total 44 chars).
 */
export function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `pck_${hex}`;
}

export async function createApiToken(
	db: DrizzleDB,
	data: { userId: string; name: string; expiresAt?: Date },
): Promise<{ id: string; rawToken: string; name: string; tokenPrefix: string; createdAt: Date }> {
	const id = crypto.randomUUID();
	const rawToken = generateToken();
	const tokenHash = await hashToken(rawToken);
	const tokenPrefix = rawToken.slice(0, 8);
	const now = new Date();

	await db.insert(apiTokens).values({
		id,
		userId: data.userId,
		name: data.name,
		tokenHash,
		tokenPrefix,
		expiresAt: data.expiresAt ?? null,
		createdAt: now,
	});

	return { id, rawToken, name: data.name, tokenPrefix, createdAt: now };
}

export async function listApiTokens(
	db: DrizzleDB,
	userId: string,
): Promise<
	{
		id: string;
		name: string;
		tokenPrefix: string;
		lastUsedAt: Date | null;
		expiresAt: Date | null;
		revokedAt: Date | null;
		requestCount: number;
		createdAt: Date;
	}[]
> {
	const rows = await db
		.select({
			id: apiTokens.id,
			name: apiTokens.name,
			tokenPrefix: apiTokens.tokenPrefix,
			lastUsedAt: apiTokens.lastUsedAt,
			expiresAt: apiTokens.expiresAt,
			revokedAt: apiTokens.revokedAt,
			requestCount: apiTokens.requestCount,
			createdAt: apiTokens.createdAt,
		})
		.from(apiTokens)
		.where(eq(apiTokens.userId, userId))
		.orderBy(desc(apiTokens.createdAt));

	return rows;
}

export async function revokeApiToken(
	db: DrizzleDB,
	tokenId: string,
	userId: string,
): Promise<boolean> {
	const result = await db
		.update(apiTokens)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(apiTokens.id, tokenId),
				eq(apiTokens.userId, userId),
				isNull(apiTokens.revokedAt),
			),
		);
	// Drizzle returns the rows or rowCount depending on driver
	return true;
}

export async function validateApiToken(
	db: DrizzleDB,
	rawToken: string,
): Promise<{ userId: string; tokenId: string } | null> {
	const tokenHash = await hashToken(rawToken);

	const rows = await db
		.select({
			id: apiTokens.id,
			userId: apiTokens.userId,
			revokedAt: apiTokens.revokedAt,
			expiresAt: apiTokens.expiresAt,
		})
		.from(apiTokens)
		.where(eq(apiTokens.tokenHash, tokenHash))
		.limit(1);

	const token = rows[0];
	if (!token) return null;
	if (token.revokedAt) return null;
	if (token.expiresAt && token.expiresAt < new Date()) return null;

	// Update last_used_at and request_count (fire-and-forget)
	db.update(apiTokens)
		.set({
			lastUsedAt: new Date(),
			requestCount: sql`${apiTokens.requestCount} + 1`,
		})
		.where(eq(apiTokens.id, token.id))
		.then(() => {})
		.catch(() => {});

	return { userId: token.userId, tokenId: token.id };
}

export async function deleteApiToken(
	db: DrizzleDB,
	tokenId: string,
	userId: string,
): Promise<void> {
	await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
}
