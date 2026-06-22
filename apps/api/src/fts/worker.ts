/**
 * Async text extraction worker.
 * Processes extraction jobs without blocking uploads.
 */
import { getDb } from "../db.ts";
import { extractTextFromFile, isSupportedForExtraction } from "./extract.ts";
import {
	markExtractionPending,
	markExtractionProcessing,
	saveExtractionResult,
} from "./search.ts";
import { resolveStoredFilePath, getUploadConfig } from "../uploads/config.ts";
import * as repo from "@procomun/db/repository";

/**
 * Queue an extraction job for a resource after upload completion.
 * This is fire-and-forget — errors are recorded in the DB, not thrown.
 */
export async function enqueueExtraction(
	resourceId: string,
	uploadId: string,
): Promise<void> {
	const db = getDb().db;
	await markExtractionPending(db, resourceId);

	// Process asynchronously — don't block the upload response
	processExtraction(resourceId, uploadId).catch((err) => {
		console.error(
			`[fts] Unhandled extraction error for resource=${resourceId}:`,
			err?.message ?? err,
		);
	});
}

/**
 * Process text extraction for a resource.
 */
export async function processExtraction(
	resourceId: string,
	uploadId: string,
): Promise<void> {
	const db = getDb().db;

	// Get upload session to find file details
	const session = await repo.getUploadSessionById(db, uploadId);
	if (!session || session.status !== "completed") {
		await saveExtractionResult(db, resourceId, {
			text: "",
			status: "skipped",
		});
		return;
	}

	const filename = session.originalFilename;

	// Check if the file type is supported
	if (!isSupportedForExtraction(filename)) {
		await saveExtractionResult(db, resourceId, {
			text: "",
			status: "skipped",
		});
		return;
	}

	// Mark as processing
	await markExtractionProcessing(db, resourceId);

	// Resolve file path
	const config = getUploadConfig();
	const filePath = resolveStoredFilePath(config, uploadId);

	// Extract text
	const result = await extractTextFromFile(filePath, filename);

	if (result.error) {
		console.error(
			`[fts] Extraction error: resource=${resourceId}, file=${filename}, error=${result.error}`,
		);
		await saveExtractionResult(db, resourceId, {
			text: "",
			status: "error",
			error: result.error,
		});
		return;
	}

	if (result.skipped) {
		await saveExtractionResult(db, resourceId, {
			text: "",
			status: "skipped",
		});
		return;
	}

	await saveExtractionResult(db, resourceId, {
		text: result.text,
		status: "completed",
	});
}

/**
 * Re-extract text for a single resource from its primary upload.
 * Used for manual reindexing.
 */
export async function reExtractResource(resourceId: string): Promise<void> {
	const db = getDb().db;
	const uploads = await repo.listUploadSessionsForResource(db, resourceId);
	const completedUpload = uploads.find(
		(u: { status: string }) => u.status === "completed",
	);

	if (!completedUpload) {
		// No file to extract — just update search vector from metadata
		await saveExtractionResult(db, resourceId, {
			text: "",
			status: "skipped",
		});
		return;
	}

	await processExtraction(resourceId, completedUpload.id);
}
