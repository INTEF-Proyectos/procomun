/**
 * Contador de visitas por recurso (ADR-0044, #421).
 *
 * Una visita por sesión: el navegador manda un UUID aleatorio de la pestaña
 * (sessionStorage) y aquí solo se guarda su SHA-256, sin usuario ni IP. Si el
 * par recurso + sesión ya existe dentro de la ventana, no suma.
 */
import { createHash } from "node:crypto";
import {
	collections,
	collectionViewSessions,
	resourceViewCounts,
	resourceViewSessions,
} from "@procomun/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db.ts";

/** Pasada la ventana se purgan las sesiones: una pestaña abierta más de un día vuelve a contar. */
export const VIEW_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidViewSessionId(value: unknown): value is string {
	return typeof value === "string" && UUID_RE.test(value);
}

export function hashViewSession(sessionId: string): string {
	return createHash("sha256").update(sessionId.toLowerCase()).digest("hex");
}

export async function getResourceViewCount(resourceId: string) {
	const db = getDb().db;
	const rows = await db
		.select({
			total: sql<number>`${resourceViewCounts.viewCount} + coalesce(${resourceViewCounts.legacyViewCount}, 0)`,
		})
		.from(resourceViewCounts)
		.where(eq(resourceViewCounts.resourceId, resourceId))
		.limit(1);
	return Number(rows[0]?.total ?? 0);
}

export async function recordResourceView(
	resourceId: string,
	sessionId: string,
	options: { now?: Date; windowMs?: number } = {},
) {
	const db = getDb().db;
	const now = options.now ?? new Date();
	const windowMs = options.windowMs ?? VIEW_SESSION_WINDOW_MS;
	const sessionHash = hashViewSession(sessionId);

	await db.transaction(async (tx: typeof db) => {
		await tx
			.delete(resourceViewSessions)
			.where(
				and(
					eq(resourceViewSessions.resourceId, resourceId),
					lt(
						resourceViewSessions.createdAt,
						new Date(now.getTime() - windowMs),
					),
				),
			);
		const inserted = await tx
			.insert(resourceViewSessions)
			.values({ resourceId, sessionHash, createdAt: now })
			.onConflictDoNothing()
			.returning({ resourceId: resourceViewSessions.resourceId });
		if (!inserted[0]) return;

		await tx
			.insert(resourceViewCounts)
			.values({ resourceId, viewCount: 1, updatedAt: now })
			.onConflictDoUpdate({
				target: resourceViewCounts.resourceId,
				set: {
					viewCount: sql`${resourceViewCounts.viewCount} + 1`,
					updatedAt: now,
				},
			});
	});

	return getResourceViewCount(resourceId);
}

/** Bloquea la colección mientras registra la visita y actualiza el total. */
export async function recordCollectionView(slug: string, sessionId: string) {
	const db = getDb().db;
	const now = new Date();
	const sessionHash = hashViewSession(`collection:${sessionId}`);
	return db.transaction(async (tx: typeof db) => {
		const [collection] = await tx
			.select({ id: collections.id, viewCount: collections.viewCount })
			.from(collections)
			.where(
				and(
					eq(collections.slug, slug),
					eq(collections.editorialStatus, "published"),
				),
			)
			.for("update");
		if (!collection) return null;
		await tx
			.delete(collectionViewSessions)
			.where(
				and(
					eq(collectionViewSessions.collectionId, collection.id),
					lt(
						collectionViewSessions.createdAt,
						new Date(now.getTime() - VIEW_SESSION_WINDOW_MS),
					),
				),
			);
		const [inserted] = await tx
			.insert(collectionViewSessions)
			.values({ collectionId: collection.id, sessionHash, createdAt: now })
			.onConflictDoNothing()
			.returning({ collectionId: collectionViewSessions.collectionId });
		if (!inserted) return collection.viewCount;
		const viewCount = collection.viewCount + 1;
		await tx
			.update(collections)
			.set({ viewCount })
			.where(eq(collections.id, collection.id));
		return viewCount;
	});
}
