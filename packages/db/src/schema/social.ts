import { relations } from "drizzle-orm";
import {
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { resources } from "./resources.ts";

// Ratings: one rating per user per resource, score 1-5
export const ratings = pgTable(
	"ratings",
	{
		id: text("id").primaryKey(),
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		score: integer("score").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		unique("ratings_user_resource").on(table.resourceId, table.userId),
	],
);

// Favorites: one favorite per user per resource
export const favorites = pgTable(
	"favorites",
	{
		id: text("id").primaryKey(),
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		unique("favorites_user_resource").on(table.resourceId, table.userId),
	],
);

// Visitas (ADR-0044): contador por recurso. legacy_view_count guarda el valor
// histórico del Procomún antiguo, que se suma al contado en la plataforma.
export const resourceViewCounts = pgTable("resource_view_counts", {
	resourceId: text("resource_id")
		.primaryKey()
		.references(() => resources.id, { onDelete: "cascade" }),
	viewCount: integer("view_count").notNull().default(0),
	legacyViewCount: integer("legacy_view_count"),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Sesiones ya contadas por recurso: solo el hash del identificador aleatorio
// de la pestaña, sin usuario ni IP. Se purgan pasada la ventana de dedup.
export const resourceViewSessions = pgTable(
	"resource_view_sessions",
	{
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		sessionHash: varchar("session_hash", { length: 64 }).notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		unique("resource_view_sessions_resource_session").on(
			table.resourceId,
			table.sessionHash,
		),
	],
);

// Downloads: tracks resource download events
export const downloads = pgTable("downloads", {
	id: text("id").primaryKey(),
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
	userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
	format: varchar("format", { length: 20 }).notNull().default("direct"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Activity events: user action history for the dashboard feed
export const activityEvents = pgTable("activity_events", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	type: varchar("type", { length: 50 }).notNull(),
	resourceId: text("resource_id").references(() => resources.id, {
		onDelete: "set null",
	}),
	resourceTitle: text("resource_title"),
	resourceSlug: varchar("resource_slug", { length: 512 }),
	description: text("description").notNull(),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// API access logs for ENS audit compliance
export const apiAccessLogs = pgTable("api_access_logs", {
	id: text("id").primaryKey(),
	userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
	method: varchar("method", { length: 10 }).notNull(),
	path: text("path").notNull(),
	status: integer("status").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	latencyMs: integer("latency_ms"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const ratingsRelations = relations(ratings, ({ one }) => ({
	resource: one(resources, {
		fields: [ratings.resourceId],
		references: [resources.id],
	}),
	user: one(user, {
		fields: [ratings.userId],
		references: [user.id],
	}),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
	resource: one(resources, {
		fields: [favorites.resourceId],
		references: [resources.id],
	}),
	user: one(user, {
		fields: [favorites.userId],
		references: [user.id],
	}),
}));

export const downloadsRelations = relations(downloads, ({ one }) => ({
	resource: one(resources, {
		fields: [downloads.resourceId],
		references: [resources.id],
	}),
	user: one(user, {
		fields: [downloads.userId],
		references: [user.id],
	}),
}));

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
	user: one(user, {
		fields: [activityEvents.userId],
		references: [user.id],
	}),
	resource: one(resources, {
		fields: [activityEvents.resourceId],
		references: [resources.id],
	}),
}));

export const apiAccessLogsRelations = relations(apiAccessLogs, ({ one }) => ({
	user: one(user, {
		fields: [apiAccessLogs.userId],
		references: [user.id],
	}),
}));
