import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { type AuthEnv, requireRole } from "../../auth/middleware.ts";
import { getCurrentUser } from "../../auth/roles.ts";
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

	const result = await repo.listReports(getDb().db, {
		limit,
		offset,
		status: status || undefined,
		reason: reason || undefined,
		resourceId: resourceId || undefined,
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

	await repo.updateReport(getDb().db, id, {
		status: body.status as repo.ReportStatus | undefined,
		moderatorId: currentUser.id,
		resolution: body.resolution,
		actionTaken: body.actionTaken as repo.ReportAction | undefined,
	});

	// Apply real action on the resource if applicable
	if (body.actionTaken === "resource_deactivated" && report.resourceId) {
		await repo.updateEditorialStatus(
			getDb().db,
			report.resourceId,
			"archived",
			currentUser.id,
		);
	} else if (body.actionTaken === "resource_deleted" && report.resourceId) {
		await repo.deleteResource(getDb().db, report.resourceId);
	}

	const updated = await repo.getReportById(getDb().db, id);
	return c.json(updated);
});

export { reportRoutes };
