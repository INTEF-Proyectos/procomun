import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";

/**
 * Solo para tests: asocia un hash de .elpx a un recurso publicado.
 *
 * Desde la issue #466 la ruta pública `/api/v1/elpx/<hash>/` solo sirve el
 * contenido de recursos publicados. Los tests que prueban el servido (CSP,
 * reescritura de URL, MIME…) registran así el hash que extraen a disco.
 * Es idempotente: si el hash ya existe, publica su recurso.
 */
export async function seedPublishedElpxHash(
	hash: string,
	extractPath = `/tmp/elpx/${hash}`,
): Promise<{ resourceId: string }> {
	const db = getDb().db;
	const existing = await repo.getElpxProjectByHash(db, hash);
	if (existing) {
		await repo.updateEditorialStatus(
			db,
			existing.resourceId,
			"published",
			"system",
		);
		return { resourceId: existing.resourceId };
	}
	const resource = await repo.createResource(db, {
		title: `Paquete de prueba ${hash.slice(0, 8)}`,
		description: "Recurso publicado para probar el servido del .elpx",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
	});
	await repo.updateEditorialStatus(db, resource.id, "published", "system");
	await repo.createElpxProject(db, {
		resourceId: resource.id,
		hash,
		extractPath,
		originalFilename: `${hash.slice(0, 8)}.elpx`,
		hasPreview: true,
	});
	return { resourceId: resource.id };
}
