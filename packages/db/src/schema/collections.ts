import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { resources } from "./resources.ts";

export const collections = pgTable(
	"collections",
	{
		id: text("id").primaryKey(),
		slug: varchar("slug", { length: 512 }).notNull().unique(),
		title: text("title").notNull(),
		description: text("description").notNull(),
		coverImageUrl: text("cover_image_url"),
		viewCount: integer("view_count").notNull().default(0),
		isOrdered: boolean("is_ordered").notNull().default(false),
		editorialStatus: varchar("editorial_status", { length: 50 })
			.notNull()
			.default("draft"),
		curatorId: text("curator_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
		// #432: itinerario del Procomún antiguo del que sale la colección
		// (migración 0022). Null en las colecciones creadas en la plataforma.
		importSource: text("import_source"),
		externalId: text("external_id"),
		/** Fecha de publicación en el Procomún antiguo (`publicationDate`). */
		publishedAt: timestamp("published_at"),
	},
	(table) => [
		// Misma clave que resources_import_source_external_id_idx: reimportar un
		// itinerario no crea otra colección. Parcial: las creadas a mano no la tienen.
		uniqueIndex("collections_import_source_external_id_idx")
			.on(table.importSource, table.externalId)
			.where(sql`${table.externalId} IS NOT NULL`),
	],
);

export const collectionViewSessions = pgTable(
	"collection_view_sessions",
	{
		collectionId: text("collection_id")
			.notNull()
			.references(() => collections.id, { onDelete: "cascade" }),
		sessionHash: varchar("session_hash", { length: 64 }).notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.collectionId, table.sessionHash] }),
		index("collection_view_sessions_collection_created_at_idx").on(
			table.collectionId,
			table.createdAt,
		),
	],
);

export const collectionResources = pgTable("collection_resources", {
	collectionId: text("collection_id")
		.notNull()
		.references(() => collections.id, { onDelete: "cascade" }),
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
	position: integer("position").notNull().default(0),
});

// Relaciones
export const collectionsRelations = relations(collections, ({ one, many }) => ({
	curator: one(user, {
		fields: [collections.curatorId],
		references: [user.id],
	}),
	resources: many(collectionResources),
}));

export const collectionResourcesRelations = relations(
	collectionResources,
	({ one }) => ({
		collection: one(collections, {
			fields: [collectionResources.collectionId],
			references: [collections.id],
		}),
		resource: one(resources, {
			fields: [collectionResources.resourceId],
			references: [resources.id],
		}),
	}),
);
