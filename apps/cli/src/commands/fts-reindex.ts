/**
 * CLI command: reindex all resources for Full Text Search.
 * Usage: bun run apps/cli/src/index.ts fts:reindex
 */

export async function loadFtsReindexDependencies() {
	const [{ getDb, waitForDb }, { reindexAllResources }] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("../../../api/src/fts/search.ts"),
	]);

	return { getDb, waitForDb, reindexAllResources };
}

export async function ftsReindex() {
	const { getDb, waitForDb, reindexAllResources } = await loadFtsReindexDependencies();

	await waitForDb();
	const db = getDb().db;

	console.log("[fts:reindex] Starting full reindex of all resources...");

	const result = await reindexAllResources(db, {
		batchSize: 50,
		onProgress: (processed) => {
			if (processed % 100 === 0) {
				console.log(`[fts:reindex] Processed ${processed} resources...`);
			}
		},
	});

	console.log(
		`[fts:reindex] Complete. Reindexed ${result.processed} resources.`,
	);
}
