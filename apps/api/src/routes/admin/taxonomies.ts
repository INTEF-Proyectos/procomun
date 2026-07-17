import * as repo from "@procomun/db/repository";
import { DuplicateTaxonomyError } from "@procomun/db/repository";
import { validateTaxonomy } from "@procomun/db/validation";
import { logActivity } from "../../activity/log.ts";
import { buildCrudRoutes } from "../crud-builder.ts";

const taxonomyRoutes = buildCrudRoutes({
	baseRole: "curator",
	list: (db, opts) =>
		repo.listTaxonomies(db, opts as Parameters<typeof repo.listTaxonomies>[1]),
	getById: repo.getTaxonomyById,
	create: async (db, data) => {
		const d = data as Parameters<typeof repo.createTaxonomy>[1];
		if (d.parentId) {
			const parent = await repo.getTaxonomyById(db, d.parentId);
			if (!parent) {
				throw new Error("PARENT_NOT_FOUND");
			}
		}
		try {
			return await repo.createTaxonomy(db, d);
		} catch (err) {
			if (err instanceof DuplicateTaxonomyError) {
				const error = Object.assign(new Error(err.message), { status: 409 });
				throw error;
			}
			throw err;
		}
	},
	update: async (db, id, data) => {
		const d = data as Parameters<typeof repo.updateTaxonomy>[2];
		if (d.parentId) {
			const parent = await repo.getTaxonomyById(db, d.parentId);
			if (!parent) {
				throw new Error("PARENT_NOT_FOUND");
			}
			if (d.parentId === id) {
				throw new Error("PARENT_SELF_REFERENCE");
			}
		}
		return repo.updateTaxonomy(db, id, d);
	},
	remove: repo.deleteTaxonomy,
	validateCreate: validateTaxonomy,
	validateUpdate: validateTaxonomy,
	mergeOnUpdate: true,
	listFilters: (_user, params) => ({ type: params.type }),
	afterCreate: async (user, result, data) => {
		const t = result as { id: string; name: string };
		await logActivity({
			userId: user.id,
			type: "taxonomy_created",
			description: `Creaste la taxonomía «${data.name}»`,
			metadata: { taxonomyId: t.id },
		});
	},
	afterUpdate: async (user, id, entity, data) => {
		const t = entity as { name: string };
		await logActivity({
			userId: user.id,
			type: "taxonomy_updated",
			description: `Actualizaste la taxonomía «${t.name}»`,
			metadata: { taxonomyId: id, updates: data },
		});
	},
	afterDelete: async (user, id, entity) => {
		const t = entity as { name: string };
		await logActivity({
			userId: user.id,
			type: "taxonomy_deleted",
			description: `Eliminaste la taxonomía «${t.name}»`,
			metadata: { taxonomyId: id },
		});
	},
	roles: { create: "admin", update: "admin", remove: "admin" },
	notFoundMessage: "Categoría no encontrada",
});

export { taxonomyRoutes };
