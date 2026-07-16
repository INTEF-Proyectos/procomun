import { and, desc, eq, sql } from "drizzle-orm";
import { user } from "../schema/auth.ts";
import { reports } from "../schema/reports.ts";
import { resources } from "../schema/resources.ts";
import {
	type DrizzleDB,
	normalizePagination,
	optionalAndWhere,
} from "./shared.ts";

export const REPORT_REASONS = [
	"inappropriate",
	"copyright",
	"incorrect_info",
	"broken_link",
	"spam",
	"other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = [
	"pending",
	"in_review",
	"resolved",
	"dismissed",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = [
	"dismissed",
	"resolved_no_change",
	"resource_edited",
	"resource_deactivated",
	"resource_deleted",
	"referred_editorial",
] as const;

export type ReportAction = (typeof REPORT_ACTIONS)[number];

type CreateReportInput = {
	resourceId: string;
	reporterId?: string | null;
	reason: ReportReason;
	description?: string | null;
};

type ListReportsOptions = {
	limit?: number;
	offset?: number;
	status?: string;
	reason?: string;
	resourceId?: string;
};

type UpdateReportInput = {
	status?: ReportStatus;
	moderatorId?: string;
	resolution?: string;
	actionTaken?: ReportAction;
};

const reportListSelection = {
	id: reports.id,
	resourceId: reports.resourceId,
	resourceTitle: resources.title,
	resourceSlug: resources.slug,
	reporterId: reports.reporterId,
	reason: reports.reason,
	description: reports.description,
	status: reports.status,
	moderatorId: reports.moderatorId,
	resolution: reports.resolution,
	actionTaken: reports.actionTaken,
	createdAt: reports.createdAt,
	updatedAt: reports.updatedAt,
	resolvedAt: reports.resolvedAt,
};

export async function createReport(db: DrizzleDB, input: CreateReportInput) {
	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(reports).values({
		id,
		resourceId: input.resourceId,
		reporterId: input.reporterId ?? null,
		reason: input.reason,
		description: input.description ?? null,
		status: "pending",
		createdAt: now,
		updatedAt: now,
	});
	return { id };
}

export async function listReports(
	db: DrizzleDB,
	opts: ListReportsOptions = {},
) {
	const { limit, offset } = normalizePagination(opts);

	const conditions = [
		opts.status ? eq(reports.status, opts.status) : undefined,
		opts.reason ? eq(reports.reason, opts.reason) : undefined,
		opts.resourceId ? eq(reports.resourceId, opts.resourceId) : undefined,
	].filter(Boolean);

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const rows = await db
		.select(reportListSelection)
		.from(reports)
		.innerJoin(resources, eq(reports.resourceId, resources.id))
		.where(where)
		.orderBy(desc(reports.createdAt))
		.limit(limit)
		.offset(offset);

	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(reports)
		.innerJoin(resources, eq(reports.resourceId, resources.id))
		.where(where);

	return {
		data: rows,
		total: Number(countResult[0]?.count ?? 0),
		limit,
		offset,
	};
}

export async function getReportById(db: DrizzleDB, reportId: string) {
	const rows = await db
		.select({
			...reportListSelection,
			reporterName: user.name,
		})
		.from(reports)
		.innerJoin(resources, eq(reports.resourceId, resources.id))
		.leftJoin(user, eq(reports.reporterId, user.id))
		.where(eq(reports.id, reportId))
		.limit(1);

	return rows[0] ?? null;
}

export async function updateReport(
	db: DrizzleDB,
	reportId: string,
	input: UpdateReportInput,
) {
	const updates: Record<string, unknown> = {
		updatedAt: new Date(),
	};

	if (input.status) updates.status = input.status;
	if (input.moderatorId) updates.moderatorId = input.moderatorId;
	if (input.resolution !== undefined) updates.resolution = input.resolution;
	if (input.actionTaken) updates.actionTaken = input.actionTaken;

	if (input.status === "resolved" || input.status === "dismissed") {
		updates.resolvedAt = new Date();
	}

	await db.update(reports).set(updates).where(eq(reports.id, reportId));
}

export async function getReportCountByResource(
	db: DrizzleDB,
	resourceId: string,
) {
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(reports)
		.where(
			and(eq(reports.resourceId, resourceId), eq(reports.status, "pending")),
		);

	return Number(result[0]?.count ?? 0);
}
