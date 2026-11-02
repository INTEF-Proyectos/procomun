import { sql } from "drizzle-orm";
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
 * Catálogo de áreas de conocimiento (issue #448, ADR-0045). Los bloques son
 * fijos y viven en código (`knowledge-areas.ts`); aquí solo su id. Un área
 * no se borra: se desactiva y conserva sus asociaciones.
 */
export const knowledgeAreas = pgTable(
	"knowledge_areas",
	{
		id: text("id").primaryKey(),
		label: text("label").notNull(),
		description: text("description"),
		blockId: varchar("block_id", { length: 64 }).notNull(),
		position: integer("position").notNull().default(0),
		active: boolean("active").notNull().default(true),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		// Dos altas simultáneas no pueden crear la misma denominación normalizada.
		uniqueIndex("knowledge_areas_label_unique").on(
			sql`lower(translate(${table.label}, 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUnN'))`,
		),
		index("knowledge_areas_block_idx").on(table.blockId),
	],
);

/** Recurso ↔ área de conocimiento (máximo 3 por recurso, en la aplicación). */
export const resourceKnowledgeAreas = pgTable(
	"resource_knowledge_areas",
	{
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		areaId: text("area_id")
			.notNull()
			.references(() => knowledgeAreas.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.resourceId, table.areaId] }),
		index("resource_knowledge_areas_area_idx").on(table.areaId),
	],
);

/** Recurso ↔ familia profesional (lista cerrada en código, solo FP). */
export const resourceProfessionalFamilies = pgTable(
	"resource_professional_families",
	{
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		familyId: varchar("family_id", { length: 64 }).notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.resourceId, table.familyId] }),
		index("resource_professional_families_family_idx").on(table.familyId),
	],
);
