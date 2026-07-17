import {
	integer,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * API tokens for programmatic access to the resource publication API.
 * Each user can create multiple tokens; tokens are stored as SHA-256 hashes.
 */
export const apiTokens = pgTable("api_tokens", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	name: varchar("name", { length: 255 }).notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
	tokenPrefix: varchar("token_prefix", { length: 8 }).notNull(),
	lastUsedAt: timestamp("last_used_at"),
	expiresAt: timestamp("expires_at"),
	revokedAt: timestamp("revoked_at"),
	requestCount: integer("request_count").notNull().default(0),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});
