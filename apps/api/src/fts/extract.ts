/**
 * Text extraction from various file formats.
 * Supports: TXT, MD, CSV, HTML, PDF, DOCX.
 */
import { readFile } from "node:fs/promises";

/** Maximum extracted text size in bytes (~500 KB) */
const MAX_EXTRACTED_TEXT_BYTES = 500 * 1024;
const WHITESPACE = /\s/u;

export type ExtractionResult = {
	text: string;
	skipped?: boolean;
	error?: string;
};

const SUPPORTED_EXTENSIONS = new Set([
	".txt",
	".md",
	".csv",
	".html",
	".htm",
	".pdf",
	".docx",
]);

export function isSupportedForExtraction(filename: string): boolean {
	const ext = getExtension(filename);
	return SUPPORTED_EXTENSIONS.has(ext);
}

function getExtension(filename: string): string {
	const idx = filename.lastIndexOf(".");
	if (idx === -1) return "";
	return filename.slice(idx).toLowerCase();
}

/**
 * Extract text from a file. Returns extracted text or an error/skip indicator.
 */
export async function extractTextFromFile(
	filePath: string,
	filename: string,
): Promise<ExtractionResult> {
	const ext = getExtension(filename);

	if (!SUPPORTED_EXTENSIONS.has(ext)) {
		return { text: "", skipped: true };
	}

	try {
		let text: string;
		switch (ext) {
			case ".txt":
			case ".md":
			case ".csv":
				text = await extractPlainText(filePath);
				break;
			case ".html":
			case ".htm":
				text = await extractHtml(filePath);
				break;
			case ".pdf":
				text = await extractPdf(filePath);
				break;
			case ".docx":
				text = await extractDocx(filePath);
				break;
			default:
				return { text: "", skipped: true };
		}

		return { text: normalizeText(text) };
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Unknown extraction error";
		return { text: "", error: message };
	}
}

async function extractPlainText(filePath: string): Promise<string> {
	const buffer = await readFile(filePath);
	return buffer.toString("utf-8");
}

async function extractHtml(filePath: string): Promise<string> {
	const buffer = await readFile(filePath);
	const html = buffer.toString("utf-8");
	return stripHtml(html);
}

export function stripHtml(html: string): string {
	const { load } = require("cheerio");
	const $ = load(html);
	// Remove script and style elements
	$("script, style, noscript").remove();
	return $.text();
}

async function extractPdf(filePath: string): Promise<string> {
	const buffer = await readFile(filePath);
	const pdfParse = require("pdf-parse");
	const data = await pdfParse(buffer);
	return data.text ?? "";
}

async function extractDocx(filePath: string): Promise<string> {
	const buffer = await readFile(filePath);
	const mammoth = require("mammoth");
	const result = await mammoth.extractRawText({ buffer });
	return result.value ?? "";
}

/**
 * Normalize extracted text: compact whitespace, trim, and truncate.
 *
 * The output is built incrementally and never grows beyond the configured
 * limit. This avoids the full-size Array.from/filter/join copies that made the
 * peak memory usage proportional to several copies of a large extracted file.
 */
export function normalizeText(text: string): string {
	let cleaned = "";
	let cleanedBytes = 0;
	let pendingWhitespace = "";
	let pendingBytes = 0;
	let pendingExceedsLimit = false;
	let lastPendingChar = "";
	let consecutiveNewlines = 0;
	let truncated = false;

	function resetPendingWhitespace() {
		pendingWhitespace = "";
		pendingBytes = 0;
		pendingExceedsLimit = false;
		lastPendingChar = "";
		consecutiveNewlines = 0;
	}

	function appendPendingWhitespace(value: string) {
		const valueBytes = Buffer.byteLength(value, "utf-8");
		if (
			pendingExceedsLimit ||
			cleanedBytes + pendingBytes + valueBytes > MAX_EXTRACTED_TEXT_BYTES
		) {
			// Keep scanning: this whitespace may be trailing and therefore trimmed.
			pendingExceedsLimit = true;
		} else {
			pendingWhitespace += value;
			pendingBytes += valueBytes;
		}

		lastPendingChar = value;
		consecutiveNewlines = value === "\n" ? consecutiveNewlines + 1 : 0;
	}

	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		const isControl =
			(code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
			code === 0x7f;
		if (isControl) continue;

		if (WHITESPACE.test(ch)) {
			// String.trim() removed leading whitespace in the previous implementation.
			if (cleaned.length === 0) continue;

			if (ch === " " || ch === "\t") {
				if (lastPendingChar === " ") continue;
				appendPendingWhitespace(" ");
				continue;
			}

			if (ch === "\n") {
				if (consecutiveNewlines >= 2) continue;
				appendPendingWhitespace(ch);
				continue;
			}

			appendPendingWhitespace(ch);
			continue;
		}

		if (pendingExceedsLimit) {
			truncated = true;
			break;
		}

		if (pendingWhitespace) {
			cleaned += pendingWhitespace;
			cleanedBytes += pendingBytes;
			resetPendingWhitespace();
		}

		const charBytes = Buffer.byteLength(ch, "utf-8");
		if (cleanedBytes + charBytes > MAX_EXTRACTED_TEXT_BYTES) {
			truncated = true;
			break;
		}

		cleaned += ch;
		cleanedBytes += charBytes;
	}

	// Pending whitespace is deliberately not flushed, matching String.trim().
	if (truncated) {
		const lastSpace = cleaned.lastIndexOf(" ");
		if (
			lastSpace > 0 &&
			Buffer.byteLength(cleaned.slice(0, lastSpace), "utf-8") >
				MAX_EXTRACTED_TEXT_BYTES * 0.9
		) {
			cleaned = cleaned.slice(0, lastSpace);
		}
	}

	return cleaned;
}
