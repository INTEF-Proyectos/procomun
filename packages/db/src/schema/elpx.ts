import { relations } from "drizzle-orm";
import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { resources } from "./resources.ts";

export const elpxProjects = pgTable("elpx_projects", {
	id: text("id").primaryKey(),
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" })
		.unique(),
	hash: varchar("hash", { length: 64 }).notNull().unique(),
	extractPath: text("extract_path").notNull(),
	originalFilename: text("original_filename").notNull(),
	uploadSessionId: text("upload_session_id"),
	version: integer("version").notNull().default(3),
	hasPreview: boolean("has_preview").notNull().default(false),
	hasScreenshot: boolean("has_screenshot").notNull().default(false),
	// Miniatura generada en el servidor (#470, ADR-0046). Nulo en los
	// proyectos anteriores al cambio hasta que pasa el relleno.
	thumbnailStatus: text("thumbnail_status"),
	thumbnailFile: text("thumbnail_file"),
	thumbnailAttempts: integer("thumbnail_attempts").notNull().default(0),
	thumbnailError: text("thumbnail_error"),
	thumbnailUpdatedAt: timestamp("thumbnail_updated_at", {
		withTimezone: true,
	}),
	thumbnailNextAttemptAt: timestamp("thumbnail_next_attempt_at", {
		withTimezone: true,
	}),
	elpxMetadata: jsonb("elpx_metadata"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const elpxProjectsRelations = relations(elpxProjects, ({ one }) => ({
	resource: one(resources, {
		fields: [elpxProjects.resourceId],
		references: [resources.id],
	}),
}));
