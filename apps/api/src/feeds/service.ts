import * as repo from "@procomun/db/repository";
import { Feed } from "feed";
import { getDb } from "../db.ts";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface FeedOptions {
	baseUrl: string;
	limit?: number;
	offset?: number;
	resourceType?: string;
	language?: string;
	license?: string;
	search?: string;
	collectionSlug?: string;
	createdBy?: string;
}

interface FeedResource {
	id: string;
	title: string | null;
	slug: string | null;
	description: string | null;
	author: string | null;
	createdByName?: string | null;
	createdAt: string | Date | null;
	updatedAt?: string | Date | null;
	resourceType: string | null;
	language: string | null;
	license: string | null;
	keywords?: string | null;
}

export function buildFeed(opts: {
	title: string;
	description: string;
	feedId: string;
	feedUrl: string;
	siteUrl: string;
	resources: FeedResource[];
	baseUrl: string;
	total: number;
	limit: number;
	offset: number;
}): Feed {
	const {
		title,
		description,
		feedId,
		feedUrl,
		siteUrl,
		resources,
		baseUrl,
		total,
		limit,
		offset,
	} = opts;

	const feed = new Feed({
		title,
		description,
		id: feedId,
		link: siteUrl,
		language: "es",
		updated: resources.length > 0 ? toDate(resources[0].createdAt) : new Date(),
		generator: "Procomún",
		feedLinks: {
			atom: feedUrl,
		},
		copyright: "Contenido bajo licencias abiertas individuales de cada recurso",
	});

	// Pagination links (RFC 5005)
	const totalPages = Math.ceil(total / limit);
	const currentPage = Math.floor(offset / limit) + 1;

	if (currentPage < totalPages) {
		const nextOffset = offset + limit;
		feed.addExtension({
			name: "_custom",
			objects: {
				nextUrl: appendPagination(feedUrl, limit, nextOffset),
			},
		});
	}

	for (const resource of resources) {
		const resourceUrl = `${baseUrl}/recursos/${resource.slug ?? resource.id}`;
		const categories: { name: string; term?: string }[] = [];

		if (resource.resourceType) {
			categories.push({
				name: resource.resourceType,
				term: resource.resourceType,
			});
		}
		if (resource.keywords) {
			for (const kw of resource.keywords
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean)) {
				categories.push({ name: kw });
			}
		}

		feed.addItem({
			title: resource.title ?? "Sin título",
			id: resourceUrl,
			link: resourceUrl,
			description: resource.description ?? "",
			date: toDate(resource.createdAt),
			author:
				resource.author || resource.createdByName
					? [{ name: resource.author ?? resource.createdByName ?? "Anónimo" }]
					: [{ name: "Anónimo" }],
			category: categories,
			extensions: resource.license
				? [{ name: "dc:rights", objects: resource.license }]
				: [],
		});
	}

	return feed;
}

export async function buildGeneralFeed(opts: FeedOptions) {
	const db = getDb().db;
	const limit = normalizeLimit(opts.limit);
	const offset = opts.offset ?? 0;

	const result = await repo.listResources(db, {
		limit,
		offset,
		status: "published",
		resourceType: opts.resourceType,
		language: opts.language,
		license: opts.license,
		search: opts.search,
	});

	const feedUrl = `${opts.baseUrl}/feeds/atom/resources`;
	const description = opts.search
		? `Recursos educativos: "${opts.search}"`
		: "Últimos recursos educativos publicados";

	return buildFeed({
		title: "Procomún - Recursos Educativos",
		description,
		feedId: feedUrl,
		feedUrl,
		siteUrl: opts.baseUrl,
		resources: result.data as FeedResource[],
		baseUrl: opts.baseUrl,
		total: result.total,
		limit,
		offset,
	});
}

export async function buildCollectionFeed(
	opts: FeedOptions & { collectionSlug: string },
) {
	const db = getDb().db;
	const limit = normalizeLimit(opts.limit);
	const offset = opts.offset ?? 0;

	const collection = await repo.getCollectionBySlug(db, opts.collectionSlug, {
		status: "published",
		resourceStatus: "published",
	});

	if (!collection) {
		return null;
	}

	const resources = await repo.listCollectionResources(db, collection.id, {
		limit,
		offset,
		status: "published",
	});

	const feedUrl = `${opts.baseUrl}/feeds/atom/collections/${opts.collectionSlug}`;

	return buildFeed({
		title: `Procomún - ${collection.title}`,
		description:
			collection.description ??
			`Recursos de la colección "${collection.title}"`,
		feedId: feedUrl,
		feedUrl,
		siteUrl: `${opts.baseUrl}/colecciones/${opts.collectionSlug}`,
		resources: resources.map((r) => ({
			...r,
			id: r.resourceId,
			createdAt: null,
			updatedAt: null,
			keywords: null,
			createdByName: r.createdByName ?? null,
		})) as FeedResource[],
		baseUrl: opts.baseUrl,
		total: resources.length,
		limit,
		offset,
	});
}

export async function buildUserFeed(opts: FeedOptions & { createdBy: string }) {
	const db = getDb().db;
	const limit = normalizeLimit(opts.limit);
	const offset = opts.offset ?? 0;

	const result = await repo.listResources(db, {
		limit,
		offset,
		status: "published",
		createdBy: opts.createdBy,
	});

	const feedUrl = `${opts.baseUrl}/feeds/atom/users/${opts.createdBy}`;

	return buildFeed({
		title: `Procomún - Recursos del autor`,
		description: `Recursos educativos publicados por el autor`,
		feedId: feedUrl,
		feedUrl,
		siteUrl: opts.baseUrl,
		resources: result.data as FeedResource[],
		baseUrl: opts.baseUrl,
		total: result.total,
		limit,
		offset,
	});
}

function normalizeLimit(limit?: number): number {
	if (!limit || limit < 1) return DEFAULT_PAGE_SIZE;
	return Math.min(limit, MAX_PAGE_SIZE);
}

function toDate(value: string | Date | null | undefined): Date {
	if (!value) return new Date();
	if (value instanceof Date) return value;
	return new Date(value);
}

function appendPagination(url: string, limit: number, offset: number): string {
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}limit=${limit}&offset=${offset}`;
}
