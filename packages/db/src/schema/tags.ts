import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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

/**
 * Atomized educational tags (ADR-0034 / issue #76).
 * `canonicalTagId` points to the preferred tag when this row is a synonym.
 */
export const tags = pgTable(
	"tags",
	{
		id: text("id").primaryKey(),
		slug: varchar("slug", { length: 255 }).notNull().unique(),
		label: text("label").notNull(),
		description: text("description"),
		usageCount: integer("usage_count").notNull().default(0),
		canonicalTagId: text("canonical_tag_id").references(
			(): AnyPgColumn => tags.id,
			{ onDelete: "set null" },
		),
		/** Palabra clave del catálogo controlado (ADR-0042). */
		catalog: boolean("catalog").notNull().default(false),
		/**
		 * Término de catálogo retirado porque pasa a ser un área de
		 * conocimiento (#448). No se ofrece para nuevas selecciones; los
		 * recursos que ya lo tienen lo conservan.
		 */
		retiredAt: timestamp("retired_at"),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("tags_label_idx").on(table.label),
		index("tags_usage_count_idx").on(table.usageCount),
		index("tags_canonical_tag_id_idx").on(table.canonicalTagId),
		// Dos altas simultáneas no pueden crear la misma denominación normalizada.
		uniqueIndex("tags_catalog_label_unique")
			.on(
				sql`lower(translate(${table.label}, 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUnN'))`,
			)
			.where(sql`${table.catalog}`),
	],
);

/**
 * Alias de búsqueda de una palabra clave. No se seleccionan ni se guardan
 * como términos; un alias puede apuntar a varias (ABP).
 */
export const tagAliases = pgTable(
	"tag_aliases",
	{
		id: text("id").primaryKey(),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		alias: text("alias").notNull(),
		normalized: text("normalized").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("tag_aliases_tag_normalized_unique").on(
			table.tagId,
			table.normalized,
		),
	],
);

/** Many-to-many: resources ↔ tags */
export const resourceTags = pgTable(
	"resource_tags",
	{
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.resourceId, table.tagId] }),
		index("resource_tags_tag_id_idx").on(table.tagId),
	],
);
