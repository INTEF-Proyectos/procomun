import { asc, eq } from "drizzle-orm";
import { normalizeEducationalAssignments } from "../educational-areas.ts";
import { resourceEducationalAreas } from "../schema/resources.ts";
import type { DrizzleDB } from "./shared.ts";

export async function listResourceEducationalAreas(
	db: DrizzleDB,
	resourceId: string,
) {
	return db
		.select({
			categoryId: resourceEducationalAreas.categoryId,
			optionId: resourceEducationalAreas.optionId,
		})
		.from(resourceEducationalAreas)
		.where(eq(resourceEducationalAreas.resourceId, resourceId))
		.orderBy(
			asc(resourceEducationalAreas.categoryId),
			asc(resourceEducationalAreas.optionId),
		);
}

export async function replaceResourceEducationalAreas(
	db: DrizzleDB,
	resourceId: string,
	value: unknown,
) {
	const assignments = normalizeEducationalAssignments(value);
	await db.transaction(async (tx) => {
		await tx
			.delete(resourceEducationalAreas)
			.where(eq(resourceEducationalAreas.resourceId, resourceId));
		if (assignments.length === 0) return;
		await tx.insert(resourceEducationalAreas).values(
			assignments.map((assignment) => ({
				resourceId,
				categoryId: assignment.categoryId,
				optionId: assignment.optionId,
			})),
		);
	});
}
