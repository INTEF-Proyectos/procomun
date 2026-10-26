/**
 * Miniaturas copiadas a nuestro almacenamiento (#409): hoy, las imágenes
 * `preview` del Procomún antiguo. El nombre es el sha256 del contenido, así
 * que la respuesta es inmutable y no revela nada del recurso.
 */
import { Hono } from "hono";
import {
	THUMBNAIL_FILE_RE,
	THUMBNAIL_MIME,
	thumbnailPath,
} from "../services/legacy-preview-image.ts";
import { getUploadConfig } from "../uploads/config.ts";

export function createThumbnailRoutes(
	getStorageDir: () => string = () => getUploadConfig().storageDir,
) {
	const routes = new Hono();

	routes.get("/:file", async (c) => {
		const { file } = c.req.param();
		const match = THUMBNAIL_FILE_RE.exec(file);
		if (!match?.[1]) return c.json({ error: "No encontrado" }, 404);

		const body = Bun.file(thumbnailPath(getStorageDir(), file));
		if (!(await body.exists())) return c.json({ error: "No encontrado" }, 404);

		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": THUMBNAIL_MIME[match[1]] ?? "application/octet-stream",
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		});
	});

	return routes;
}

export const thumbnailRoutes = createThumbnailRoutes();
