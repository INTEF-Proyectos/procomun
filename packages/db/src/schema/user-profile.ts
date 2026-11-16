import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Datos de perfil migrados del Procomún anterior (issue #456, ADR-0037 adenda
 * 2026-10-27). Uno a uno con `user`. Es privado: ningún endpoint lo expone
 * todavía. Solo guarda lo acordado en la issue; DNI, fecha de nacimiento,
 * sexo, estudios y ocupación no se importan.
 */
export const userProfile = pgTable("user_profile", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	/** ISO 3166-1 alfa-2. */
	countryCode: varchar("country_code", { length: 2 }),
	locality: text("locality"),
	educationalCenter: text("educational_center"),
	educationalCenterUrl: text("educational_center_url"),
	/** «Sobre mí» del perfil antiguo. */
	about: text("about"),
	website: text("website"),
	facebook: text("facebook"),
	linkedin: text("linkedin"),
	twitter: text("twitter"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
