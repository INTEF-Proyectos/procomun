import { relations, sql } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

// Custom type for tsvector (not natively supported by Drizzle)
const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

export const resources = pgTable(
	"resources",
	{
		id: text("id").primaryKey(),
		slug: varchar("slug", { length: 512 }).notNull().unique(),
		externalId: text("external_id"),
		sourceUri: text("source_uri"),

		// Metadatos descriptivos
		title: text("title").notNull(),
		description: text("description").notNull(),
		language: varchar("language", { length: 10 }),
		license: varchar("license", { length: 50 }).notNull(),
		resourceType: varchar("resource_type", { length: 100 }).notNull(),
		keywords: text("keywords"),
		author: text("author"),
		otherAuthors: text("other_authors"),
		publisher: text("publisher"),
		thumbnailUrl: text("thumbnail_url"),
		duration: integer("duration"),

		// Accesibilidad
		accessibilityFeatures: text("accessibility_features"),
		accessibilityHazards: text("accessibility_hazards"),
		accessMode: text("access_mode"),

		// Autoría
		createdBy: text("created_by").references(() => user.id),

		// Estado editorial
		editorialStatus: varchar("editorial_status", { length: 50 })
			.notNull()
			.default("draft"),
		assignedCuratorId: text("assigned_curator_id").references(() => user.id),
		curatedAt: timestamp("curated_at"),
		featuredAt: timestamp("featured_at"),
		// Sello «Validado» (issue #420, ADR-0049, migración 0035). validated_at no
		// nulo = validado; validated_by es nulo en los importados con `certified`.
		validatedAt: timestamp("validated_at"),
		validatedBy: text("validated_by").references(() => user.id, {
			onDelete: "set null",
		}),
		validationSource: varchar("validation_source", { length: 20 }),

		// Importación
		importedAt: timestamp("imported_at"),
		importSource: text("import_source"),

		// Full Text Search
		extractedText: text("extracted_text"),
		searchVector: tsvector("search_vector"),
		extractionStatus: varchar("extraction_status", { length: 20 })
			.notNull()
			.default("pending"),
		extractedAt: timestamp("extracted_at"),
		extractionError: text("extraction_error"),

		// Versionado (issue #31): puntero a la versión vigente en resource_versions.
		// FK declarada solo en SQL (setup.ts / migración) para evitar la importación
		// circular resources ↔ versions en Drizzle. Null hasta la primera publicación.
		currentVersionId: text("current_version_id"),

		// Sistema
		deletedAt: timestamp("deleted_at"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		// Garantiza idempotencia a nivel de BD para importadores externos: un mismo
		// (import_source, external_id) no puede crear dos recursos. Parcial porque
		// external_id es null para recursos no importados (no deben restringirse entre sí).
		uniqueIndex("resources_import_source_external_id_idx")
			.on(table.importSource, table.externalId)
			.where(sql`${table.externalId} IS NOT NULL`),
	],
);

export const mediaItems = pgTable("media_items", {
	id: text("id").primaryKey(),
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
	type: varchar("type", { length: 50 }).notNull(),
	mimeType: varchar("mime_type", { length: 255 }),
	url: text("url").notNull(),
	fileSize: integer("file_size"),
	filename: text("filename"),
	isPrimary: boolean("is_primary").notNull().default(false),
});

// Tablas de unión para relaciones many-to-many
export const resourceSubjects = pgTable("resource_subjects", {
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
	subject: varchar("subject", { length: 255 }).notNull(),
});

export const resourceLevels = pgTable("resource_levels", {
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
	level: varchar("level", { length: 100 }).notNull(),
});

// Categorización educativa de dos niveles (issue #380). option_id null = solo categoría.
export const resourceEducationalAreas = pgTable(
	"resource_educational_areas",
	{
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		categoryId: varchar("category_id", { length: 64 }).notNull(),
		optionId: varchar("option_id", { length: 64 }),
	},
	(table) => [
		uniqueIndex("resource_educational_areas_category_only_uidx")
			.on(table.resourceId, table.categoryId)
			.where(sql`${table.optionId} IS NULL`),
		uniqueIndex("resource_educational_areas_option_uidx")
			.on(table.resourceId, table.categoryId, table.optionId)
			.where(sql`${table.optionId} IS NOT NULL`),
		index("resource_educational_areas_lookup_idx").on(
			table.categoryId,
			table.optionId,
		),
	],
);

// Relaciones
export const resourcesRelations = relations(resources, ({ one, many }) => ({
	curator: one(user, {
		fields: [resources.assignedCuratorId],
		references: [user.id],
	}),
	mediaItems: many(mediaItems),
	subjects: many(resourceSubjects),
	levels: many(resourceLevels),
	educationalAreas: many(resourceEducationalAreas),
}));

export const mediaItemsRelations = relations(mediaItems, ({ one }) => ({
	resource: one(resources, {
		fields: [mediaItems.resourceId],
		references: [resources.id],
	}),
}));

export const resourceSubjectsRelations = relations(
	resourceSubjects,
	({ one }) => ({
		resource: one(resources, {
			fields: [resourceSubjects.resourceId],
			references: [resources.id],
		}),
	}),
);

export const resourceLevelsRelations = relations(resourceLevels, ({ one }) => ({
	resource: one(resources, {
		fields: [resourceLevels.resourceId],
		references: [resources.id],
	}),
}));

export const resourceEducationalAreasRelations = relations(
	resourceEducationalAreas,
	({ one }) => ({
		resource: one(resources, {
			fields: [resourceEducationalAreas.resourceId],
			references: [resources.id],
		}),
	}),
);
