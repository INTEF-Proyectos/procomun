/**
 * Full Text Search service using PostgreSQL native FTS.
 * Generates tsvector, performs searches, and handles reindexing.
 */
import { sql, eq, isNull } from "drizzle-orm";
import { resources } from "@procomun/db/schema";

// biome-ignore lint: generic drizzle db type
type DrizzleDB = any;

/** FTS dictionary configuration by language code */
const LANGUAGE_CONFIGS: Record<string, string> = {
	es: "spanish",
	en: "english",
	fr: "french",
	de: "german",
	it: "italian",
	pt: "portuguese",
	ca: "spanish", // Catalan falls back to Spanish in PostgreSQL
	eu: "spanish", // Basque falls back to Spanish
	gl: "spanish", // Galician falls back to Spanish
};

function getFtsConfig(language: string): string {
	return LANGUAGE_CONFIGS[language] ?? "spanish";
}

/**
 * Check if unaccent extension is available. Cache the result.
 */
let _unaccentAvailable: boolean | null = null;

async function isUnaccentAvailable(db: DrizzleDB): Promise<boolean> {
	if (_unaccentAvailable !== null) return _unaccentAvailable;
	try {
		await db.execute(sql`SELECT unaccent('test')`);
		_unaccentAvailable = true;
	} catch {
		_unaccentAvailable = false;
	}
	return _unaccentAvailable;
}

/** Reset unaccent cache (for testing) */
export function resetUnaccentCache() {
	_unaccentAvailable = null;
}

/**
 * Update the search_vector for a specific resource.
 * Combines title (A), keywords (B), description (C), extracted_text (D).
 */
export async function updateSearchVector(db: DrizzleDB, resourceId: string) {
	const hasUnaccent = await isUnaccentAvailable(db);

	if (hasUnaccent) {
		await db.execute(sql`
			UPDATE resources SET search_vector =
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					unaccent(coalesce(title, ''))
				), 'A') ||
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					unaccent(coalesce(keywords, ''))
				), 'B') ||
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					unaccent(coalesce(description, ''))
				), 'C') ||
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					unaccent(coalesce(extracted_text, ''))
				), 'D')
			WHERE id = ${resourceId}
		`);
	} else {
		await db.execute(sql`
			UPDATE resources SET search_vector =
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					coalesce(title, '')
				), 'A') ||
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					coalesce(keywords, '')
				), 'B') ||
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					coalesce(description, '')
				), 'C') ||
				setweight(to_tsvector(
					(CASE WHEN language IN ('en') THEN 'english' ELSE 'spanish' END)::regconfig,
					coalesce(extracted_text, '')
				), 'D')
			WHERE id = ${resourceId}
		`);
	}
}

/**
 * Update extraction results and search vector for a resource.
 */
export async function saveExtractionResult(
	db: DrizzleDB,
	resourceId: string,
	result: {
		text: string;
		status: "completed" | "error" | "skipped";
		error?: string;
	},
) {
	const now = new Date();

	await db
		.update(resources)
		.set({
			extractedText: result.text || null,
			extractionStatus: result.status,
			extractedAt: result.status === "completed" ? now : null,
			extractionError: result.error ?? null,
			updatedAt: now,
		})
		.where(eq(resources.id, resourceId));

	// Update the search vector after extraction
	await updateSearchVector(db, resourceId);
}

/**
 * Mark a resource as pending extraction.
 */
export async function markExtractionPending(db: DrizzleDB, resourceId: string) {
	await db
		.update(resources)
		.set({
			extractionStatus: "pending",
			extractionError: null,
		})
		.where(eq(resources.id, resourceId));
}

/**
 * Mark a resource as currently being processed for extraction.
 */
export async function markExtractionProcessing(
	db: DrizzleDB,
	resourceId: string,
) {
	await db
		.update(resources)
		.set({ extractionStatus: "processing" })
		.where(eq(resources.id, resourceId));
}

export type FtsSearchOptions = {
	query: string;
	limit?: number;
	offset?: number;
	language?: string;
	status?: string;
};

export type FtsSearchResult = {
	id: string;
	slug: string;
	title: string;
	description: string;
	rank: number;
	headline: string | null;
};

/**
 * Perform a full-text search using PostgreSQL FTS.
 * Returns results ranked by relevance with highlighted snippets.
 */
export async function searchResources(
	db: DrizzleDB,
	opts: FtsSearchOptions,
): Promise<{ data: FtsSearchResult[]; total: number }> {
	const limit = Math.min(opts.limit ?? 20, 100);
	const offset = opts.offset ?? 0;
	const config = getFtsConfig(opts.language ?? "es");
	const status = opts.status ?? "published";
	const hasUnaccent = await isUnaccentAvailable(db);

	let results: FtsSearchResult[];
	let countResult: { total: string | number }[];

	if (hasUnaccent) {
		const rawResults = await db.execute(sql`
			SELECT
				r.id,
				r.slug,
				r.title,
				r.description,
				ts_rank(r.search_vector, websearch_to_tsquery(${config}::regconfig, unaccent(${opts.query}))) AS rank,
				ts_headline(
					${config}::regconfig,
					coalesce(r.description, ''),
					websearch_to_tsquery(${config}::regconfig, unaccent(${opts.query})),
					'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
				) AS headline
			FROM resources r
			WHERE r.search_vector @@ websearch_to_tsquery(${config}::regconfig, unaccent(${opts.query}))
				AND r.editorial_status = ${status}
				AND r.deleted_at IS NULL
			ORDER BY rank DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`);
		results = (rawResults.rows ?? rawResults) as unknown as FtsSearchResult[];

		const rawCount = await db.execute(sql`
			SELECT count(*) AS total
			FROM resources r
			WHERE r.search_vector @@ websearch_to_tsquery(${config}::regconfig, unaccent(${opts.query}))
				AND r.editorial_status = ${status}
				AND r.deleted_at IS NULL
		`);
		countResult = (rawCount.rows ?? rawCount) as unknown as { total: string | number }[];
	} else {
		const rawResults = await db.execute(sql`
			SELECT
				r.id,
				r.slug,
				r.title,
				r.description,
				ts_rank(r.search_vector, websearch_to_tsquery(${config}::regconfig, ${opts.query})) AS rank,
				ts_headline(
					${config}::regconfig,
					coalesce(r.description, ''),
					websearch_to_tsquery(${config}::regconfig, ${opts.query}),
					'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
				) AS headline
			FROM resources r
			WHERE r.search_vector @@ websearch_to_tsquery(${config}::regconfig, ${opts.query})
				AND r.editorial_status = ${status}
				AND r.deleted_at IS NULL
			ORDER BY rank DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`);
		results = (rawResults.rows ?? rawResults) as unknown as FtsSearchResult[];

		const rawCount = await db.execute(sql`
			SELECT count(*) AS total
			FROM resources r
			WHERE r.search_vector @@ websearch_to_tsquery(${config}::regconfig, ${opts.query})
				AND r.editorial_status = ${status}
				AND r.deleted_at IS NULL
		`);
		countResult = (rawCount.rows ?? rawCount) as unknown as { total: string | number }[];
	}

	const total = Number(countResult[0]?.total ?? 0);

	return { data: results, total };
}

/**
 * Reindex search vector for a single resource.
 */
export async function reindexResource(db: DrizzleDB, resourceId: string) {
	await updateSearchVector(db, resourceId);
}

/**
 * Reindex search vectors for all non-deleted resources.
 * Processes in batches to avoid memory issues.
 */
export async function reindexAllResources(
	db: DrizzleDB,
	opts?: { batchSize?: number; onProgress?: (processed: number) => void },
) {
	const batchSize = opts?.batchSize ?? 100;
	let processed = 0;
	let hasMore = true;

	while (hasMore) {
		const batch = await db
			.select({ id: resources.id })
			.from(resources)
			.where(isNull(resources.deletedAt))
			.limit(batchSize)
			.offset(processed);

		if (batch.length === 0) {
			break;
		}

		for (const resource of batch) {
			await updateSearchVector(db, resource.id);
		}

		processed += batch.length;
		opts?.onProgress?.(processed);

		if (batch.length < batchSize) {
			hasMore = false;
		}
	}

	return { processed };
}
