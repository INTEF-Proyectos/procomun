import { describe, expect, test } from "bun:test";
import {
	PREVIEW_MULTIPART_OVERHEAD_BYTES,
	previewMultipartMaxRequestBytes,
	validatePreviewMultipartContentLength,
} from "./routes.ts";

describe("preview multipart raw body limit", () => {
	test("adds a bounded allowance for multipart metadata", () => {
		expect(previewMultipartMaxRequestBytes(1024)).toBe(
			1024 + PREVIEW_MULTIPART_OVERHEAD_BYTES,
		);
	});

	test("allows a missing Content-Length for the Bun transport cap to handle", () => {
		expect(validatePreviewMultipartContentLength(undefined, 1024)).toBeNull();
	});

	test("rejects invalid or negative Content-Length values", () => {
		expect(validatePreviewMultipartContentLength("invalid", 1024)).toEqual({
			status: 400,
			error: "Content-Length no válido",
		});
		expect(validatePreviewMultipartContentLength("-1", 1024)?.status).toBe(400);
	});

	test("accepts the exact limit and rejects the next byte", () => {
		expect(validatePreviewMultipartContentLength("1024", 1024)).toBeNull();
		expect(validatePreviewMultipartContentLength("1025", 1024)).toEqual({
			status: 413,
			error: "La petición de previsualización supera el tamaño máximo (1024 bytes)",
		});
	});
});
