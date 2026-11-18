import * as repo from "@procomun/db/repository";
import { canViewResource, validateCollection } from "@procomun/db/validation";
import { logActivity } from "../../activity/log.ts";
import {
	canManageCollection,
	getCurrentUser,
	hasMinRole,
} from "../../auth/roles.ts";
import { ensureCurrentUser } from "../../auth/user-sync.ts";
import { getDb } from "../../db.ts";
import { thumbnailUrlForViewer } from "../../thumbnails/access.ts";
import { buildCrudRoutes } from "../crud-builder.ts";
import { parseJsonBodyOrNull, requireManageableCollection } from "./guards.ts";

const collectionRoutes = buildCrudRoutes({
	baseRole: "curator",
	list: (db, opts) =>
		repo.listCollections(
			db,
			opts as Parameters<typeof repo.listCollections>[1],
		),
	getById: repo.getCollectionById,
	create: (db, data) =>
		repo.createCollection(
			db,
			data as Parameters<typeof repo.createCollection>[1],
		),
	update: (db, id, data) => {
		const payload = data as Record<string, unknown>;
		return repo.updateCollection(db, id, {
			title: typeof payload.title === "string" ? payload.title : undefined,
			description:
				typeof payload.description === "string"
					? payload.description
					: undefined,
			coverImageUrl:
				typeof payload.coverImageUrl === "string"
					? payload.coverImageUrl
					: payload.coverImageUrl === null
						? null
						: undefined,
			editorialStatus:
				typeof payload.editorialStatus === "string"
					? payload.editorialStatus
					: undefined,
			isOrdered:
				typeof payload.isOrdered === "boolean" ? payload.isOrdered : undefined,
		});
	},
	remove: repo.deleteCollection,
	validateCreate: validateCollection,
	validateUpdate: validateCollection,
	mergeOnUpdate: true,
	canManage: canManageCollection,
	listFilters: (user) => ({
		curatorId: undefined,
		// #538: el curator no ve en el listado los borradores de otro curator;
		// el admin, todos. Misma regla que canManageCollection, y que #460 en
		// los recursos.
		hideOthersDraftsFor: hasMinRole(user.role, "admin") ? undefined : user.id,
	}),
	prepareCreate: async (body, user) => {
		await ensureCurrentUser(user);
		return {
			title: body.title,
			description: body.description,
			coverImageUrl:
				typeof body.coverImageUrl === "string" ? body.coverImageUrl : null,
			curatorId: user.id,
			editorialStatus:
				typeof body.editorialStatus === "string"
					? body.editorialStatus
					: undefined,
			isOrdered: !!body.isOrdered,
		};
	},
	afterCreate: async (user, result, data) => {
		const c = result as { id: string; title: string };
		await logActivity({
			userId: user.id,
			type: "collection_created",
			description: `Creaste la colección «${data.title}»`,
			metadata: { collectionId: c.id },
		});
	},
	afterUpdate: async (user, id, entity, data) => {
		const c = entity as { title: string };
		await logActivity({
			userId: user.id,
			type: "collection_updated",
			description: `Actualizaste la colección «${c.title}»`,
			metadata: { collectionId: id, updates: data },
		});
	},
	afterDelete: async (user, id, entity) => {
		const c = entity as { title: string };
		await logActivity({
			userId: user.id,
			type: "collection_deleted",
			description: `Eliminaste la colección «${c.title}»`,
			metadata: { collectionId: id },
		});
	},
	notFoundMessage: "Colección no encontrada",
});

collectionRoutes.get("/:id/resources", async (c) => {
	const { id } = c.req.param();
	const check = await requireManageableCollection(c, id);
	if ("response" in check) return check.response;

	const resources = await repo.listCollectionResources(getDb().db, id, {
		limit: 100,
	});
	// Revisión de #481: la colección puede tener recursos no publicados, también
	// borradores ajenos (#460). Su preview legacy sale firmada si el usuario
	// puede verlos y no sale si no.
	const user = getCurrentUser(c);
	return c.json(
		resources.map((resource) => ({
			...resource,
			thumbnailUrl: thumbnailUrlForViewer(resource, user),
		})),
	);
});

collectionRoutes.post("/:id/resources", async (c) => {
	const { id } = c.req.param();
	const check = await requireManageableCollection(c, id);
	if ("response" in check) return check.response;

	const body = await parseJsonBodyOrNull<{ resourceId?: string }>(c);
	if (!body?.resourceId) {
		return c.json({ error: "resourceId es obligatorio" }, 400);
	}

	const resource = await repo.getResourceById(getDb().db, body.resourceId);
	// #460: un borrador ajeno no existe para el curator.
	if (!resource || !canViewResource(getCurrentUser(c), resource)) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const linkedResources = await repo.listCollectionResources(getDb().db, id, {
		limit: 100,
	});
	if (linkedResources.some((item) => item.resourceId === body.resourceId)) {
		return c.json({ error: "El recurso ya está asociado a la colección" }, 409);
	}

	await repo.addResourceToCollection(getDb().db, id, body.resourceId);
	return c.json({ ok: true }, 201);
});

collectionRoutes.delete("/:id/resources/:resourceId", async (c) => {
	const { id, resourceId } = c.req.param();
	const check = await requireManageableCollection(c, id);
	if ("response" in check) return check.response;

	await repo.removeResourceFromCollection(getDb().db, id, resourceId);
	return c.json({ ok: true });
});

collectionRoutes.patch("/:id/resources/reorder", async (c) => {
	const { id } = c.req.param();
	const check = await requireManageableCollection(c, id);
	if ("response" in check) return check.response;

	const body = await parseJsonBodyOrNull<{
		resourceId?: string;
		direction?: "up" | "down";
	}>(c);
	if (
		!body?.resourceId ||
		!body.direction ||
		!["up", "down"].includes(body.direction)
	) {
		return c.json(
			{ error: "resourceId y direction válidos son obligatorios" },
			400,
		);
	}

	const reordered = await repo.reorderCollectionResource(
		getDb().db,
		id,
		body.resourceId,
		body.direction,
	);
	if (!reordered) {
		return c.json({ error: "No se pudo reordenar el recurso" }, 400);
	}

	return c.json({ ok: true });
});

export { collectionRoutes };
