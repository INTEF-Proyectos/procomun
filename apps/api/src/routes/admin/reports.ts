import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { type AuthEnv, requireRole } from "../../auth/middleware.ts";
import {
	canManageCollection,
	canManageResource,
	getCurrentUser,
} from "../../auth/roles.ts";
import { getDb } from "../../db.ts";
import { parsePagination } from "../../http/pagination.ts";

const reportRoutes = new Hono<AuthEnv>();

// All report management requires curator role (moderate permission)
reportRoutes.use("*", requireRole("curator"));

// ---------------------------------------------------------------------------
// GET /reports — list reports with optional filters
// ---------------------------------------------------------------------------
reportRoutes.get("/", async (c) => {
	const { limit, offset } = parsePagination(c);
	const status = c.req.query("status");
	const reason = c.req.query("reason");
	const resourceId = c.req.query("resourceId");
	const collectionId = c.req.query("collectionId");

	const result = await repo.listReports(getDb().db, {
		limit,
		offset,
		status: status || undefined,
		reason: reason || undefined,
		resourceId: resourceId || undefined,
		collectionId: collectionId || undefined,
	});

	return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /reports/:id — get report detail
// ---------------------------------------------------------------------------
reportRoutes.get("/:id", async (c) => {
	const { id } = c.req.param();
	const report = await repo.getReportById(getDb().db, id);
	if (!report) {
		return c.json({ error: "Denuncia no encontrada" }, 404);
	}
	return c.json(report);
});

// ---------------------------------------------------------------------------
// PATCH /reports/:id — update report (change status, assign, resolve)
// ---------------------------------------------------------------------------
reportRoutes.patch("/:id", async (c) => {
	const { id } = c.req.param();
	const currentUser = getCurrentUser(c);

	const report = await repo.getReportById(getDb().db, id);
	if (!report) {
		return c.json({ error: "Denuncia no encontrada" }, 404);
	}

	const body = await c.req.json<{
		status?: string;
		resolution?: string;
		actionTaken?: string;
	}>();

	// Validate status
	if (
		body.status &&
		!repo.REPORT_STATUSES.includes(body.status as repo.ReportStatus)
	) {
		return c.json(
			{ error: `Estado inválido. Válidos: ${repo.REPORT_STATUSES.join(", ")}` },
			400,
		);
	}

	// Validate actionTaken
	if (
		body.actionTaken &&
		!repo.REPORT_ACTIONS.includes(body.actionTaken as repo.ReportAction)
	) {
		return c.json(
			{ error: `Acción inválida. Válidas: ${repo.REPORT_ACTIONS.join(", ")}` },
			400,
		);
	}

	// #539: una acción de recurso no vale para una colección, ni al revés.
	const target: repo.ReportTarget = report.collectionId
		? "collection"
		: "resource";
	if (
		body.actionTaken &&
		!repo.isReportActionAllowed(body.actionTaken as repo.ReportAction, target)
	) {
		return c.json(
			{
				error:
					target === "collection"
						? "Esa acción no se aplica a una colección"
						: "Esa acción no se aplica a un recurso",
			},
			400,
		);
	}

	// La resolución y la acción van en una transacción: si falla la acción, la
	// denuncia no queda resuelta con el contenido intacto.
	const resolved = await getDb().db.transaction(async (tx: repo.DrizzleDB) => {
		// Review de #585: se lee y se bloquea el contenido dentro de la
		// transacción y se comprueba el permiso sobre su estado actual (puede
		// haber vuelto a borrador desde la denuncia). Sin permiso no se escribe nada.
		if (body.actionTaken) {
			const locked = report.collectionId
				? await repo.lockCollectionForUpdate(tx, report.collectionId)
				: report.resourceId
					? await repo.lockResourceForUpdate(tx, report.resourceId)
					: null;
			if (!locked) return "not_found" as const;
			const allowed = report.collectionId
				? canManageCollection(currentUser, locked)
				: canManageResource(currentUser, locked);
			if (!allowed) return "forbidden" as const;
		}
		await repo.updateReport(tx, id, {
			status: body.status as repo.ReportStatus | undefined,
			moderatorId: currentUser.id,
			resolution: body.resolution,
			actionTaken: body.actionTaken as repo.ReportAction | undefined,
		});
		// Se lee antes de la acción: con collection_deleted la denuncia se borra
		// con la colección (ON DELETE CASCADE) y se devuelve tal como quedó.
		const updated = await repo.getReportById(tx, id);

		if (body.actionTaken === "resource_deactivated" && report.resourceId) {
			await repo.updateEditorialStatus(
				tx,
				report.resourceId,
				"archived",
				currentUser.id,
			);
		} else if (body.actionTaken === "resource_deleted" && report.resourceId) {
			await repo.deleteResource(tx, report.resourceId);
		} else if (
			body.actionTaken === "collection_deactivated" &&
			report.collectionId
		) {
			await repo.updateCollection(tx, report.collectionId, {
				editorialStatus: "archived",
			});
		} else if (
			body.actionTaken === "collection_deleted" &&
			report.collectionId
		) {
			await repo.deleteCollection(tx, report.collectionId);
		}
		return updated;
	});

	if (resolved === "not_found") {
		return c.json({ error: "Contenido no encontrado" }, 404);
	}
	if (resolved === "forbidden") {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}
	return c.json(resolved);
});

export { reportRoutes };
