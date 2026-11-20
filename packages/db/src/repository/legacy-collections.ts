import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type {
	LegacyItineraryResourceRef,
	MappedLegacyItinerary,
} from "../legacy-import/itinerary.ts";
import { normalizeLegacyPublicatorEmail } from "../legacy-import/publicator-email.ts";
import { LEGACY_IMPORT_SYSTEM_USER_ID } from "../legacy-import/system-user.ts";
import { lowerEmail, user } from "../schema/auth.ts";
import { collectionResources, collections } from "../schema/collections.ts";
import { resources } from "../schema/resources.ts";
import type { DrizzleDB } from "./shared.ts";

/**
 * Cuenta cuyo correo coincide con el `publicatorEmailStr` de un itinerario
 * legacy (#432). Misma regla que `findLegacyAuthorAccount` de #508 para los
 * recursos: sin distinguir mayúsculas ni espacios, nunca el usuario de sistema,
 * las bloqueadas cuentan y las dadas de baja se devuelven marcadas para que el
 * llamante no les asigne nada.
 *
 * Pendiente: cuando #508 llegue a main, sustituir por `findLegacyAuthorAccount`.
 */
export async function findLegacyCollectionOwnerAccount(
	db: DrizzleDB,
	email: string,
): Promise<{ id: string; deleted: boolean; emailVerified: boolean } | null> {
	const normalized = normalizeLegacyPublicatorEmail(email);
	if (!normalized) return null;
	const [row] = await db
		.select({
			id: user.id,
			deletedAt: user.deletedAt,
			emailVerified: user.emailVerified,
		})
		.from(user)
		.where(
			and(
				eq(lowerEmail(user.email), normalized),
				ne(user.id, LEGACY_IMPORT_SYSTEM_USER_ID),
			),
		)
		.limit(1);
	return row
		? {
				id: row.id,
				deleted: row.deletedAt !== null,
				emailVerified: row.emailVerified,
			}
		: null;
}

export interface MissingLegacyCollectionResource
	extends LegacyItineraryResourceRef {
	/** `not_imported`: no hay recurso con ese external_id; `deleted`: está dado de baja. */
	reason: "not_imported" | "deleted";
}

export type LegacyCollectionOwnerOutcome =
	/** A nombre de la cuenta del autor. */
	| "owner"
	/** Sin cuenta: a nombre del usuario de sistema, en borrador. */
	| "system"
	/** Estaba a nombre del sistema y ahora tiene cuenta: pasa a su nombre. */
	| "linked"
	/** Alguien la reasignó a mano: no se toca. */
	| "kept_owner";

export interface ImportLegacyCollectionResult {
	outcome:
		| "created"
		| "updated"
		| "unchanged"
		| "would_create"
		| "would_update";
	/** null en seco cuando la colección aún no existe. */
	collectionId: string | null;
	owner: LegacyCollectionOwnerOutcome;
	linkedResources: number;
	missingResources: MissingLegacyCollectionResource[];
}

async function resolveResources(
	db: DrizzleDB,
	importSource: string,
	refs: LegacyItineraryResourceRef[],
) {
	const rows =
		refs.length === 0
			? []
			: await db
					.select({
						id: resources.id,
						externalId: resources.externalId,
						deletedAt: resources.deletedAt,
					})
					.from(resources)
					.where(
						and(
							eq(resources.importSource, importSource),
							inArray(
								resources.externalId,
								refs.map((ref) => ref.externalId),
							),
						),
					);
	const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
	const resourceIds: string[] = [];
	const missing: MissingLegacyCollectionResource[] = [];
	for (const ref of refs) {
		const row = byExternalId.get(ref.externalId);
		if (!row) missing.push({ ...ref, reason: "not_imported" });
		else if (row.deletedAt) missing.push({ ...ref, reason: "deleted" });
		else resourceIds.push(row.id);
	}
	return { resourceIds, missing };
}

async function currentResourceIds(db: DrizzleDB, collectionId: string) {
	const rows = await db
		.select({ resourceId: collectionResources.resourceId })
		.from(collectionResources)
		.where(eq(collectionResources.collectionId, collectionId))
		.orderBy(asc(collectionResources.position));
	return rows.map((row) => row.resourceId);
}

async function replaceResources(
	tx: DrizzleDB,
	collectionId: string,
	resourceIds: string[],
) {
	await tx
		.delete(collectionResources)
		.where(eq(collectionResources.collectionId, collectionId));
	if (resourceIds.length === 0) return;
	await tx.insert(collectionResources).values(
		resourceIds.map((resourceId, position) => ({
			collectionId,
			resourceId,
			position,
		})),
	);
}

function sameList(a: string[], b: string[]) {
	return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Crea o actualiza la colección de un itinerario legacy (#432), en una
 * transacción. La clave es (import_source, external_id), con índice único.
 *
 * - Propietario: la cuenta del autor (`ownerId`). Sin cuenta, el usuario de
 *   sistema y en borrador. Al reimportar solo se cambia el propietario si
 *   sigue a nombre del sistema; uno reasignado a mano se respeta (como
 *   `linkLegacyResourceAuthor` de #508), con la condición en el propio UPDATE.
 * - Estado: el de origen al crear. Al reimportar no se toca (es trabajo
 *   editorial), salvo el borrador forzado por falta de cuenta cuando aparece.
 * - Contenido: título, descripción, fecha y recursos salen del origen en cada
 *   pasada. El slug y `isOrdered` se fijan al crear.
 * - Recursos: los que no estén importados (o estén dados de baja) se omiten y
 *   se devuelven para el informe.
 */
export async function importLegacyCollection(
	db: DrizzleDB,
	input: { itinerary: MappedLegacyItinerary; ownerId: string | null },
	options: { dryRun: boolean },
): Promise<ImportLegacyCollectionResult> {
	const { itinerary, ownerId } = input;
	const { resourceIds, missing } = await resolveResources(
		db,
		itinerary.importSource,
		itinerary.resources,
	);
	const base = {
		linkedResources: resourceIds.length,
		missingResources: missing,
	};

	const [existing] = await db
		.select({
			id: collections.id,
			title: collections.title,
			description: collections.description,
			publishedAt: collections.publishedAt,
			curatorId: collections.curatorId,
			editorialStatus: collections.editorialStatus,
		})
		.from(collections)
		.where(
			and(
				eq(collections.importSource, itinerary.importSource),
				eq(collections.externalId, itinerary.externalId),
			),
		)
		.limit(1);

	if (!existing) {
		const owner: LegacyCollectionOwnerOutcome = ownerId ? "owner" : "system";
		if (options.dryRun) {
			return { ...base, outcome: "would_create", collectionId: null, owner };
		}
		const id = crypto.randomUUID();
		const now = new Date();
		await db.transaction(async (tx: DrizzleDB) => {
			await tx.insert(collections).values({
				id,
				slug: `${itinerary.slugBase}-${id.slice(0, 8)}`,
				title: itinerary.title,
				description: itinerary.description,
				isOrdered: itinerary.isOrdered,
				editorialStatus: ownerId ? itinerary.editorialStatus : "draft",
				curatorId: ownerId ?? LEGACY_IMPORT_SYSTEM_USER_ID,
				importSource: itinerary.importSource,
				externalId: itinerary.externalId,
				publishedAt: itinerary.publishedAt,
				createdAt: now,
				updatedAt: now,
			});
			await replaceResources(tx, id, resourceIds);
		});
		return { ...base, outcome: "created", collectionId: id, owner };
	}

	const owner: LegacyCollectionOwnerOutcome =
		existing.curatorId === LEGACY_IMPORT_SYSTEM_USER_ID
			? ownerId
				? "linked"
				: "system"
			: existing.curatorId === ownerId
				? "owner"
				: "kept_owner";
	const contentChanged =
		existing.title !== itinerary.title ||
		existing.description !== itinerary.description ||
		(existing.publishedAt?.getTime() ?? null) !==
			(itinerary.publishedAt?.getTime() ?? null);
	const resourcesChanged = !sameList(
		await currentResourceIds(db, existing.id),
		resourceIds,
	);

	if (!contentChanged && !resourcesChanged && owner !== "linked") {
		return { ...base, outcome: "unchanged", collectionId: existing.id, owner };
	}
	if (options.dryRun) {
		return {
			...base,
			outcome: "would_update",
			collectionId: existing.id,
			owner,
		};
	}

	let finalOwner = owner;
	await db.transaction(async (tx: DrizzleDB) => {
		if (owner === "linked" && ownerId) {
			const linked = await tx
				.update(collections)
				.set({
					curatorId: ownerId,
					// El borrador lo forzó la falta de cuenta: ahora vale el de origen.
					...(existing.editorialStatus === "draft"
						? { editorialStatus: itinerary.editorialStatus }
						: {}),
				})
				.where(
					and(
						eq(collections.id, existing.id),
						eq(collections.curatorId, LEGACY_IMPORT_SYSTEM_USER_ID),
					),
				)
				.returning({ id: collections.id });
			// Otro proceso la reasignó entre la lectura y el UPDATE.
			if (linked.length === 0) finalOwner = "kept_owner";
		}
		if (contentChanged || resourcesChanged) {
			await tx
				.update(collections)
				.set({
					title: itinerary.title,
					description: itinerary.description,
					publishedAt: itinerary.publishedAt,
					updatedAt: new Date(),
				})
				.where(eq(collections.id, existing.id));
		}
		if (resourcesChanged) {
			await replaceResources(tx, existing.id, resourceIds);
		}
	});
	return {
		...base,
		outcome: "updated",
		collectionId: existing.id,
		owner: finalOwner,
	};
}
