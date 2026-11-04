import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PUBLISHED_RESOURCE } from "./test-data";

// Paquetes .elpx sintéticos para los e2e. Desde la issue #466 la API solo
// sirve `/api/v1/elpx/<hash>/` si el hash es de un recurso publicado, así que
// el paquete se escribe en una subcarpeta del .elpx del recurso publicado del
// seed: su hash ya está en la base de datos y la URL sigue siendo la pública.
const storageDir =
	process.env.UPLOAD_STORAGE_DIR ??
	path.resolve(import.meta.dirname, "../../local-data/uploads");
const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173";

export async function createPublishedElpxPackage(): Promise<{
	/** Carpeta en disco donde escribir el paquete. */
	dir: string;
	/** Prefijo público del paquete, con barra final. */
	base: string;
	/** URL pública de su index.html. */
	url: string;
}> {
	const res = await fetch(
		`${baseURL}/api/v1/resources/${PUBLISHED_RESOURCE.slug}`,
	);
	const json = (await res.json()) as { elpxPreview?: { hash?: string } };
	const hash = json.elpxPreview?.hash;
	if (!hash) {
		throw new Error(
			`El recurso publicado del seed (${PUBLISHED_RESOURCE.slug}) no tiene .elpx`,
		);
	}
	const sub = `e2e-${randomUUID()}`;
	const dir = path.join(storageDir, "elpx", hash, sub);
	await mkdir(dir, { recursive: true });
	const base = `/api/v1/elpx/${hash}/${sub}/`;
	return { dir, base, url: `${base}index.html` };
}
