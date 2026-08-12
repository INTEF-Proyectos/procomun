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
import { elpxProjects } from "./elpx.ts";
import { resources } from "./resources.ts";

/**
 * Historial de versiones publicadas de un recurso (issue #31, ADR-0039).
 * Cada fila es un snapshot inmutable: archivo (.elpx vía elpx_projects) +
 * metadatos vigentes en el momento de publicar. `resources` mantiene la
 * proyección de la versión vigente a través de `current_version_id`.
 */
export const resourceVersions = pgTable(
	"resource_versions",
	{
		id: text("id").primaryKey(),
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		// Secuencial por recurso (1, 2, 3…), asignado bajo bloqueo de la fila
		// de resources; el UNIQUE es defensa adicional, no el mecanismo primario.
		versionNumber: integer("version_number").notNull(),
		// RESTRICT: un proyecto elpx referenciado por una versión no puede borrarse.
		elpxProjectId: text("elpx_project_id")
			.notNull()
			.references(() => elpxProjects.id, { onDelete: "restrict" }),
		// SHA-256 del .elpx (upload_sessions.finalChecksum); si la sesión no lo
		// tiene, se conserva elpx_projects.hash como identificador del contenido.
		fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
		metadataSnapshot: jsonb("metadata_snapshot").notNull(),
		changeNotes: text("change_notes"),
		createdBy: text("created_by").references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		unique("resource_versions_resource_id_version_number_unique").on(
			table.resourceId,
			table.versionNumber,
		),
	],
);

export const resourceVersionsRelations = relations(
	resourceVersions,
	({ one }) => ({
		resource: one(resources, {
			fields: [resourceVersions.resourceId],
			references: [resources.id],
		}),
		elpxProject: one(elpxProjects, {
			fields: [resourceVersions.elpxProjectId],
			references: [elpxProjects.id],
		}),
		author: one(user, {
			fields: [resourceVersions.createdBy],
			references: [user.id],
		}),
	}),
);
