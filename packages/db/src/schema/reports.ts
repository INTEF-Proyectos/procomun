import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { resources } from "./resources.ts";

/**
 * Content reports / complaints.
 * Users report resources that may violate policies or have quality issues.
 */
export const reports = pgTable("reports", {
	id: text("id").primaryKey(),
	resourceId: text("resource_id")
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
	reporterId: text("reporter_id").references(() => user.id, {
		onDelete: "set null",
	}),

	// Report content
	reason: varchar("reason", { length: 50 }).notNull(),
	description: text("description"),

	// Workflow state
	status: varchar("status", { length: 20 }).notNull().default("pending"),
	moderatorId: text("moderator_id").references(() => user.id, {
		onDelete: "set null",
	}),
	resolution: text("resolution"),
	actionTaken: varchar("action_taken", { length: 50 }),

	// Timestamps
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	resolvedAt: timestamp("resolved_at"),
});

// Relations
export const reportsRelations = relations(reports, ({ one }) => ({
	resource: one(resources, {
		fields: [reports.resourceId],
		references: [resources.id],
	}),
	reporter: one(user, {
		fields: [reports.reporterId],
		references: [user.id],
		relationName: "reporter",
	}),
	moderator: one(user, {
		fields: [reports.moderatorId],
		references: [user.id],
		relationName: "moderator",
	}),
}));
