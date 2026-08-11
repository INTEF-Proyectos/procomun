import { unlink } from "node:fs/promises";
import type { DrizzleDB } from "@procomun/db/repository";
import * as repo from "@procomun/db/repository";
import { getUploadConfig, resolveStoredFilePath } from "../uploads/config.ts";
import { removeElpxExtraction } from "./elpx-processor.ts";

/**
 * Retira la copia de trabajo anterior de un recurso al reemplazarla, salvo que
 * forme parte del historial de versiones (issue #31): un proyecto elpx
 * referenciado por resource_versions conserva su fila y su extracción, porque
 * es lo que sirven la previsualización y la descarga de esa versión.
 */
export async function retireWorkingCopyProject(
	db: DrizzleDB,
	project: { id: string; extractPath: string },
): Promise<{ retired: boolean }> {
	const references = await repo.countVersionsReferencingElpxProject(
		db,
		project.id,
	);
	if (references > 0) {
		return { retired: false };
	}
	await removeElpxExtraction(project.extractPath).catch(() => {});
	await repo.deleteElpxProject(db, project.id);
	return { retired: true };
}

/**
 * Borra el archivo crudo y cancela la sesión de subida de un adjunto
 * reemplazado, salvo que la sesión pertenezca a una versión del historial:
 * ese archivo es la fuente de descarga de la versión (RF-006).
 */
export async function retireUploadArtifacts(
	db: DrizzleDB,
	uploadId: string,
	config = getUploadConfig(),
): Promise<{ retired: boolean }> {
	const referenced = await repo.isUploadSessionReferencedByVersions(
		db,
		uploadId,
	);
	if (referenced) {
		return { retired: false };
	}
	await unlink(resolveStoredFilePath(config, uploadId)).catch(() => {});
	await repo.cancelUploadSession(db, uploadId).catch(() => {});
	return { retired: true };
}
