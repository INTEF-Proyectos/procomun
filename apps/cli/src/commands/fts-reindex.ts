/**
 * CLI command: reindex all resources for Full Text Search.
 * Usage: bun run apps/cli/src/index.ts fts:reindex
 */
import { getDb, waitForDb } from "../../api/src/db.ts";
import { reindexAllResources } from "../../api/src/fts/search.ts";

export async function ftsReindex() {
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
