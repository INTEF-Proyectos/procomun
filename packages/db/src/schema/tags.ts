import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
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
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("tags_label_idx").on(table.label),
		index("tags_usage_count_idx").on(table.usageCount),
		index("tags_canonical_tag_id_idx").on(table.canonicalTagId),
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
