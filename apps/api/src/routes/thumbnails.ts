/**
 * Miniaturas copiadas a nuestro almacenamiento: las imágenes `preview` del
 * Procomún antiguo (#409, #472) y las generadas en el servidor (#470). El
 * nombre es el sha256 del contenido y no revela nada del recurso.
 *
 * Acceso según el estado editorial (revisión de #481, adenda 2026-11-03 de
 * ADR-0046):
 * - `/:file`, la URL estable, solo sirve el fichero si pertenece al menos a un
 *   recurso publicado. Caché pública de una hora y no inmutable: el contenido
 *   de un nombre no cambia, pero el permiso sí, y al despublicar tiene que
 *   dejar de servirse.
 * - `/signed/:token/:file` sirve la de un recurso no publicado a quien recibió
 *   el enlace de una ruta que ya comprobó el acceso. Sin caché.
 * Todos los rechazos dan el mismo 404, para no revelar qué ficheros existen.
 */
import * as repo from "@procomun/db/repository";
import { type Context, Hono } from "hono";
import { getDb } from "../db.ts";
import {
	THUMBNAIL_FILE_RE,
	THUMBNAIL_MIME,
	THUMBNAIL_PUBLIC_PREFIX,
	thumbnailPath,
} from "../services/legacy-preview-image.ts";
import { verifyThumbnailToken } from "../thumbnails/access.ts";
import { getUploadConfig } from "../uploads/config.ts";

export type ThumbnailVisibility = repo.ThumbnailFileVisibility;

export const PUBLIC_THUMBNAIL_CACHE = "public, max-age=3600";
export const PRIVATE_THUMBNAIL_CACHE = "private, no-store";

export function createThumbnailRoutes(
	options: {
		getStorageDir?: () => string;
		getVisibility?: (file: string) => Promise<ThumbnailVisibility | null>;
	} = {},
) {
	const getStorageDir =
		options.getStorageDir ?? (() => getUploadConfig().storageDir);
	const getVisibility =
		options.getVisibility ??
		((file: string) =>
			repo.getThumbnailFileVisibility(
				getDb().db,
				file,
				`${THUMBNAIL_PUBLIC_PREFIX}${file}`,
			));
	const routes = new Hono();
	const notFound = (c: Context) => c.json({ error: "No encontrado" }, 404);

	async function serve(c: Context, file: string, cacheControl: string) {
		const ext = THUMBNAIL_FILE_RE.exec(file)?.[1] as string;
		const body = Bun.file(thumbnailPath(getStorageDir(), file));
		if (!(await body.exists())) return notFound(c);
		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": THUMBNAIL_MIME[ext] ?? "application/octet-stream",
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": cacheControl,
			},
		});
	}

	routes.get("/signed/:token/:file", async (c) => {
		const { token, file } = c.req.param();
		if (!THUMBNAIL_FILE_RE.test(file)) return notFound(c);
		if (!verifyThumbnailToken(file, token)) return notFound(c);
		if ((await getVisibility(file)) === null) return notFound(c);
		return serve(c, file, PRIVATE_THUMBNAIL_CACHE);
	});

	routes.get("/:file", async (c) => {
		const { file } = c.req.param();
		if (!THUMBNAIL_FILE_RE.test(file)) return notFound(c);
		if ((await getVisibility(file)) !== "public") return notFound(c);
		return serve(c, file, PUBLIC_THUMBNAIL_CACHE);
	});

	return routes;
}

export const thumbnailRoutes = createThumbnailRoutes();
