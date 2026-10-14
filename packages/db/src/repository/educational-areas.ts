import { eq } from "drizzle-orm";
import {
	EDUCATIONAL_CATEGORIES,
	type EducationalAssignment,
} from "../educational-areas.ts";
import { resourceEducationalAreas } from "../schema/resources.ts";
import type { DrizzleDB } from "./shared.ts";

// Posición de cada categoría y opción en el catálogo: la ficha, el formulario y
// la API las muestran en ese orden, no en el alfabético de los ids.
const CATALOG_POSITION = new Map<string, number>();
for (const category of EDUCATIONAL_CATEGORIES) {
	CATALOG_POSITION.set(`${category.id}\0`, CATALOG_POSITION.size);
	for (const option of category.options) {
		CATALOG_POSITION.set(`${category.id}\0${option.id}`, CATALOG_POSITION.size);
	}
}

function catalogPosition(area: EducationalAssignment): number {
	return (
		CATALOG_POSITION.get(`${area.categoryId}\0${area.optionId ?? ""}`) ??
		CATALOG_POSITION.size
	);
}

export async function listResourceEducationalAreas(
	db: DrizzleDB,
	resourceId: string,
): Promise<EducationalAssignment[]> {
	const rows = await db
		.select({
			categoryId: resourceEducationalAreas.categoryId,
			optionId: resourceEducationalAreas.optionId,
		})
		.from(resourceEducationalAreas)
		.where(eq(resourceEducationalAreas.resourceId, resourceId));
	return rows.sort((a, b) => catalogPosition(a) - catalogPosition(b));
}

/**
 * Sustituye la clasificación del recurso. Recibe asignaciones ya normalizadas
 * y debe llamarse dentro de la transacción que modifica el recurso.
 */
export async function replaceResourceEducationalAreas(
	db: DrizzleDB,
	resourceId: string,
	assignments: EducationalAssignment[],
) {
	await db
		.delete(resourceEducationalAreas)
		.where(eq(resourceEducationalAreas.resourceId, resourceId));
	if (assignments.length === 0) return;
	await db
		.insert(resourceEducationalAreas)
		.values(assignments.map((assignment) => ({ resourceId, ...assignment })));
}
