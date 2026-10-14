import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import { type AuthEnv, requireRole } from "../../auth/middleware.ts";
import { canManageResource, getCurrentUser } from "../../auth/roles.ts";
import { getDb } from "../../db.ts";
import { generateElpxFromFiles } from "../../services/elpx-generator.ts";
import {
	parseElpxMetadata,
	processElpxUpload,
} from "../../services/elpx-processor.ts";
import {
	retireUploadArtifacts,
	retireWorkingCopyProject,
} from "../../services/elpx-retire.ts";
import {
	buildUploadPublicUrl,
	computeFileSha256,
	getUploadConfig,
	resolveStoredFilePath,
} from "../../uploads/config.ts";

function isElpxFile(name: string): boolean {
	const ext = path.extname(path.basename(name)).toLowerCase();
	return ext === ".elpx" || ext === ".elp";
}

export const elpxAdminRoutes = new Hono<AuthEnv>();

elpxAdminRoutes.post("/analyze", requireRole("author"), async (c) => {
	const body = await c.req.parseBody();
	const file = body.file;

	if (!file || !(file instanceof File)) {
		return c.json({ error: "Se requiere un archivo .elpx" }, 400);
	}
	if (!isElpxFile(file.name)) {
		return c.json({ error: "El archivo debe ser .elpx" }, 400);
	}

	const safeFilename = path.basename(file.name);
	const tempPath = path.join(
		tmpdir(),
		`procomun-elpx-${crypto.randomUUID()}.elpx`,
	);
	try {
		const buffer = await file.arrayBuffer();
		await writeFile(tempPath, Buffer.from(buffer));
		const metadata = await parseElpxMetadata(tempPath);
		return c.json({ ok: true, metadata, filename: safeFilename });
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Error al analizar el archivo";
		return c.json({ error: message }, 400);
	} finally {
		await unlink(tempPath).catch(() => {});
	}
});

elpxAdminRoutes.post(
	"/upload/:resourceId",
	requireRole("author"),
	async (c) => {
		const user = getCurrentUser(c);
		const resourceId = c.req.param("resourceId");
		if (!resourceId) return c.json({ error: "Falta resourceId" }, 400);

		const resource = await repo.getResourceById(getDb().db, resourceId);
		if (!resource) return c.json({ error: "Recurso no encontrado" }, 404);
		if (!canManageResource(user, resource)) {
			return c.json({ error: "Permisos insuficientes" }, 403);
		}

		const body = await c.req.parseBody();
		const file = body.file;
		if (!file || !(file instanceof File)) {
			return c.json({ error: "Se requiere un archivo .elpx" }, 400);
		}
		if (!isElpxFile(file.name)) {
			return c.json({ error: "El archivo debe ser .elpx" }, 400);
		}

		const config = getUploadConfig();
		const existingMediaRows = await repo.listMediaItemsForResource(
			getDb().db,
			resourceId,
		);
		const prevElpxItems = existingMediaRows.filter((m) => {
			const ext = path.extname(m.filename ?? "").toLowerCase();
			return ext === ".elpx" || ext === ".elp";
		});
		await Promise.all(
			prevElpxItems.map(async (m) => {
				if (m.uploadId) {
					await retireUploadArtifacts(getDb().db, m.uploadId, config);
				}
				await repo.deleteMediaItem(getDb().db, m.id).catch(() => {});
			}),
		);

		const uploadId = crypto.randomUUID();
		const storagePath = path.join(config.storageDir, uploadId);
		const reserved = await repo.createUploadSessionWithinQuota(
			getDb().db,
			{
				id: uploadId,
				resourceId,
				ownerId: user.id,
				originalFilename: file.name,
				mimeType: "application/zip",
				storageKey: `resource/${resourceId}/${uploadId}/${file.name}`,
				declaredSize: file.size,
				expiresAt: null,
			},
			config.maxTotalBytesPerUser,
		);
		if (!reserved) {
			return c.json({ error: "Cuota de almacenamiento superada" }, 413);
		}
		await mkdir(path.dirname(storagePath), { recursive: true });
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(storagePath, buffer);
		const checksum = await computeFileSha256(storagePath);

		const media = await repo.createMediaItem(getDb().db, {
			resourceId,
			type: "file",
			mimeType: "application/zip",
			url: buildUploadPublicUrl(uploadId),
			fileSize: file.size,
			filename: file.name,
			isPrimary: true,
		});
		await repo.completeUploadSession(getDb().db, uploadId, {
			receivedBytes: file.size,
			publicUrl: buildUploadPublicUrl(uploadId),
			mediaItemId: media.id,
			finalChecksum: checksum,
		});

		const existingElpx = await repo.getElpxProjectByResourceId(
			getDb().db,
			resourceId,
		);
		if (existingElpx) {
			await retireWorkingCopyProject(getDb().db, existingElpx);
		}

		const result = await processElpxUpload(storagePath, config.storageDir);
		const { id: elpxProjectId } = await repo.createElpxProject(getDb().db, {
			resourceId,
			hash: result.hash,
			extractPath: result.extractPath,
			originalFilename: file.name,
			uploadSessionId: uploadId,
			version: 3,
			hasPreview: result.hasPreview,
			elpxMetadata: result.metadata,
		});
		const version = await repo.publishResourceVersion(getDb().db, {
			resourceId,
			elpxProjectId,
			createdBy: user.id,
		});

		return c.json({
			ok: true,
			uploadId,
			mediaItemId: media.id,
			elpxHash: result.hash,
			hasPreview: result.hasPreview,
			previewUrl: result.hasPreview ? `/api/v1/elpx/${result.hash}/` : null,
			versionNumber: version.versionNumber,
		});
	},
);

elpxAdminRoutes.post("/save/:resourceId", requireRole("author"), async (c) => {
	const user = getCurrentUser(c);
	const resourceId = c.req.param("resourceId");
	if (!resourceId) return c.json({ error: "Falta resourceId" }, 400);

	const resource = await repo.getResourceById(getDb().db, resourceId);
	if (!resource) return c.json({ error: "Recurso no encontrado" }, 404);
	if (!canManageResource(user, resource)) {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}

	const body = await c.req.parseBody();
	const file = body.file;
	if (!file || !(file instanceof File)) {
		return c.json({ error: "Se requiere un archivo .elpx" }, 400);
	}

	const config = getUploadConfig();
	const filename = file.name || "project.elpx";
	const existingElpx = await repo.getElpxProjectByResourceId(
		getDb().db,
		resourceId,
	);
	if (existingElpx) {
		await retireWorkingCopyProject(getDb().db, existingElpx);
	}

	const uploadId = crypto.randomUUID();
	const storagePath = path.join(config.storageDir, uploadId);
	const buffer = Buffer.from(await file.arrayBuffer());
	const reserved = await repo.createUploadSessionWithinQuota(
		getDb().db,
		{
			id: uploadId,
			resourceId,
			ownerId: user.id,
			originalFilename: filename,
			mimeType: "application/zip",
			storageKey: `resource/${resourceId}/${uploadId}/${filename}`,
			declaredSize: buffer.byteLength,
			expiresAt: null,
		},
		config.maxTotalBytesPerUser,
	);
	if (!reserved) {
		return c.json({ error: "Cuota de almacenamiento superada" }, 413);
	}
	await writeFile(storagePath, buffer);
	const checksum = await computeFileSha256(storagePath);

	const media = await repo.createMediaItem(getDb().db, {
		resourceId,
		type: "file",
		mimeType: "application/zip",
		url: buildUploadPublicUrl(uploadId),
		fileSize: buffer.byteLength,
		filename,
		isPrimary: true,
	});
	await repo.completeUploadSession(getDb().db, uploadId, {
		receivedBytes: buffer.byteLength,
		publicUrl: buildUploadPublicUrl(uploadId),
		mediaItemId: media.id,
		finalChecksum: checksum,
	});

	const result = await processElpxUpload(storagePath, config.storageDir);
	const { id: elpxProjectId } = await repo.createElpxProject(getDb().db, {
		resourceId,
		hash: result.hash,
		extractPath: result.extractPath,
		originalFilename: filename,
		uploadSessionId: uploadId,
		version: 3,
		hasPreview: result.hasPreview,
		elpxMetadata: result.metadata,
	});
	const version = await repo.publishResourceVersion(getDb().db, {
		resourceId,
		elpxProjectId,
		createdBy: user.id,
	});

	return c.json({
		ok: true,
		hash: result.hash,
		hasPreview: result.hasPreview,
		previewUrl: result.hasPreview ? `/api/v1/elpx/${result.hash}/` : null,
		elpxFileUrl: `/api/admin/uploads/${uploadId}/content`,
		versionNumber: version.versionNumber,
	});
});

elpxAdminRoutes.post(
	"/generate/:resourceId",
	requireRole("author"),
	async (c) => {
		const user = getCurrentUser(c);
		const resourceId = c.req.param("resourceId");
		if (!resourceId) return c.json({ error: "Falta resourceId" }, 400);

		const resource = await repo.getResourceById(getDb().db, resourceId);
		if (!resource) return c.json({ error: "Recurso no encontrado" }, 404);
		if (!canManageResource(user, resource)) {
			return c.json({ error: "Permisos insuficientes" }, 403);
		}

		const config = getUploadConfig();
		const mediaRows = await repo.listMediaItemsForResource(
			getDb().db,
			resourceId,
		);
		const filesToBundle = mediaRows
			.filter((m) => {
				if (!m.uploadId) return false;
				const ext = path.extname(m.filename ?? "").toLowerCase();
				return ext !== ".elpx" && ext !== ".elp";
			})
			.map((m) => ({
				filename: m.filename ?? m.id,
				filePath: resolveStoredFilePath(config, m.uploadId as string),
			}));

		const tempOutput = path.join(
			tmpdir(),
			`procomun-generated-${crypto.randomUUID()}.elpx`,
		);
		try {
			await generateElpxFromFiles({
				title: resource.title,
				author: resource.author ?? "",
				language: resource.language ?? "es",
				license: resource.license ?? "cc-by",
				files: filesToBundle,
				outputPath: tempOutput,
			});
		} catch (err: unknown) {
			const message =
				err instanceof Error
					? err.message
					: "Error al generar el paquete .elpx";
			return c.json({ error: message }, 500);
		}

		const existingElpx = await repo.getElpxProjectByResourceId(
			getDb().db,
			resourceId,
		);
		if (existingElpx) {
			await retireWorkingCopyProject(getDb().db, existingElpx);
		}

		const prevGenerated = mediaRows.filter(
			(m) => m.filename === "recurso-generado.elpx",
		);
		await Promise.all(
			prevGenerated.map(async (m) => {
				if (m.uploadId) {
					await retireUploadArtifacts(getDb().db, m.uploadId, config);
				}
				await repo.deleteMediaItem(getDb().db, m.id).catch(() => {});
			}),
		);

		const uploadId = crypto.randomUUID();
		const storagePath = path.join(config.storageDir, uploadId);
		await mkdir(path.dirname(storagePath), { recursive: true });
		const buffer = Buffer.from(await Bun.file(tempOutput).arrayBuffer());
		await unlink(tempOutput).catch(() => {});
		const generatedFilename = "recurso-generado.elpx";
		const reserved = await repo.createUploadSessionWithinQuota(
			getDb().db,
			{
				id: uploadId,
				resourceId,
				ownerId: user.id,
				originalFilename: generatedFilename,
				mimeType: "application/zip",
				storageKey: `resource/${resourceId}/${uploadId}/${generatedFilename}`,
				declaredSize: buffer.byteLength,
				expiresAt: null,
			},
			config.maxTotalBytesPerUser,
		);
		if (!reserved) {
			return c.json({ error: "Cuota de almacenamiento superada" }, 413);
		}
		await writeFile(storagePath, buffer);
		const checksum = await computeFileSha256(storagePath);
		const media = await repo.createMediaItem(getDb().db, {
			resourceId,
			type: "file",
			mimeType: "application/zip",
			url: buildUploadPublicUrl(uploadId),
			fileSize: buffer.byteLength,
			filename: generatedFilename,
			isPrimary: true,
		});
		await repo.completeUploadSession(getDb().db, uploadId, {
			receivedBytes: buffer.byteLength,
			publicUrl: buildUploadPublicUrl(uploadId),
			mediaItemId: media.id,
			finalChecksum: checksum,
		});

		const result = await processElpxUpload(storagePath, config.storageDir, {
			hash: crypto.randomUUID(),
		});
		const { id: elpxProjectId } = await repo.createElpxProject(getDb().db, {
			resourceId,
			hash: result.hash,
			extractPath: result.extractPath,
			originalFilename: generatedFilename,
			uploadSessionId: uploadId,
			version: 3,
			hasPreview: result.hasPreview,
			elpxMetadata: result.metadata,
		});
		const version = await repo.publishResourceVersion(getDb().db, {
			resourceId,
			elpxProjectId,
			createdBy: user.id,
		});

		return c.json({
			ok: true,
			uploadId,
			mediaItemId: media.id,
			elpxHash: result.hash,
			hasPreview: result.hasPreview,
			previewUrl: result.hasPreview ? `/api/v1/elpx/${result.hash}/` : null,
			elpxFileUrl: `/api/admin/uploads/${uploadId}/content`,
			versionNumber: version.versionNumber,
		});
	},
);

/**
 * Retira el ODE visible del recurso (issue #393). No borra la ficha.
 * La copia de trabajo sin historial se elimina con retireWorkingCopyProject.
 * Si el proyecto es una versión, se conserva el historial y deja de ser vigente,
 * así la previsualización desaparece sin reabrir el hash en la API pública.
 */
elpxAdminRoutes.delete("/:resourceId", requireRole("author"), async (c) => {
	const user = getCurrentUser(c);
	const resourceId = c.req.param("resourceId");
	if (!resourceId) return c.json({ error: "Falta resourceId" }, 400);

	const resource = await repo.getResourceById(getDb().db, resourceId);
	if (!resource) return c.json({ error: "Recurso no encontrado" }, 404);
	if (!canManageResource(user, resource)) {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}

	const project = await repo.getCurrentElpxProjectByResourceId(
		getDb().db,
		resourceId,
	);
	if (!project) {
		return c.json(
			{ error: "Este recurso no tiene un proyecto eXeLearning asociado" },
			404,
		);
	}

	const { retired } = await retireWorkingCopyProject(getDb().db, project);
	if (!retired) {
		await repo.withdrawCurrentResourceVersion(getDb().db, resourceId);
	}

	const config = getUploadConfig();
	const mediaRows = await repo.listMediaItemsForResource(
		getDb().db,
		resourceId,
	);
	const elpxMedia = mediaRows.filter((item) => isElpxFile(item.filename ?? ""));
	const uploadIds = new Set<string>();
	if (project.uploadSessionId) uploadIds.add(project.uploadSessionId);
	for (const item of elpxMedia) {
		if (item.uploadId) uploadIds.add(item.uploadId);
	}
	for (const uploadId of uploadIds) {
		await retireUploadArtifacts(getDb().db, uploadId, config);
	}
	await Promise.all(
		elpxMedia.map((item) =>
			repo.deleteMediaItem(getDb().db, item.id).catch(() => {}),
		),
	);

	await logActivity({
		userId: user.id,
		type: "ode_retired",
		resourceId,
		resourceTitle: resource.title,
		resourceSlug: resource.slug,
		description: `Retiraste el ODE «${project.originalFilename}» de «${resource.title}»`,
	});

	return c.json({ ok: true, retired, withdrawn: !retired });
});
