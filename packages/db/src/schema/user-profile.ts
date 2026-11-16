import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Datos de perfil migrados del Procomún anterior (issue #456, ADR-0037 adenda
 * 2026-10-27). Uno a uno con `user`. Es privado: solo lo ve y lo edita su
 * dueño en `/perfil` (#533) hasta que #504 decida la visibilidad; el «Sobre
 * mí» lo ve además la administración de usuarios. Solo guarda lo acordado;
 * DNI, fecha de nacimiento, sexo, estudios, ocupación y provincia no están.
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
	/** «Sobre mí»: el importado y el que se edita en /perfil (#533). */
	about: text("about"),
	website: text("website"),
	facebook: text("facebook"),
	linkedin: text("linkedin"),
	twitter: text("twitter"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
