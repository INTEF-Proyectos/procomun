/**
 * Text extraction from various file formats.
 * Supports: TXT, MD, CSV, HTML, PDF, DOCX.
 */
import { readFile } from "node:fs/promises";

/** Maximum extracted text size in bytes (~500 KB) */
const MAX_EXTRACTED_TEXT_BYTES = 500 * 1024;

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
 */
export function normalizeText(text: string): string {
	// Remove null bytes and control characters (except newlines/tabs/carriage returns),
	// filtering by code point to keep the intent explicit: drops 0x00-0x08, 0x0B, 0x0C,
	// 0x0E-0x1F and 0x7F while preserving \t (0x09), \n (0x0A) and \r (0x0D).
	let cleaned = Array.from(text)
		.filter((ch) => {
			const code = ch.codePointAt(0) ?? 0;
			const isControl =
				(code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
				code === 0x7f;
			return !isControl;
		})
		.join("");
	// Compact multiple whitespace into single space
	cleaned = cleaned.replace(/[ \t]+/g, " ");
	// Compact multiple newlines
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
	cleaned = cleaned.trim();

	// Truncate to max size
	if (Buffer.byteLength(cleaned, "utf-8") > MAX_EXTRACTED_TEXT_BYTES) {
		const buf = Buffer.from(cleaned, "utf-8");
		cleaned = buf.subarray(0, MAX_EXTRACTED_TEXT_BYTES).toString("utf-8");
		// Avoid cutting in the middle of a multi-byte char
		const lastValid = cleaned.lastIndexOf(" ");
		if (lastValid > MAX_EXTRACTED_TEXT_BYTES * 0.9) {
			cleaned = cleaned.slice(0, lastValid);
		}
	}

	return cleaned;
}
