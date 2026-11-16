import type { ValidationResult } from "@procomun/db/validation";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type AuthEnv, requireRole } from "../auth/middleware.ts";
import { getCurrentUser } from "../auth/roles.ts";
import { getDb } from "../db.ts";
import { parsePagination } from "../http/pagination.ts";

type DbFn = ReturnType<typeof getDb>["db"];
type User = { id: string; role?: string; name?: string; email?: string };

type CrudErrorBody = {
	error: string;
	details?: Array<{ field: string; message: string }>;
};

/**
 * Error lanzado por el repositorio con `status` (y, si lo trae, `field`): se
 * devuelve como respuesta. Con `field`, también en `details`, como los de la
 * validación, para que el formulario marque el campo (#448).
 */
function crudErrorBody(
	err: unknown,
	handled: { error: string },
): CrudErrorBody {
	const field =
		typeof err === "object" && err !== null
			? (err as { field?: unknown }).field
			: undefined;
	return typeof field === "string"
		? { error: handled.error, details: [{ field, message: handled.error }] }
		: { error: handled.error };
}

function jsonErrorFromCrudException(
	err: unknown,
): { error: string; status: ContentfulStatusCode } | null {
	const msg = err instanceof Error ? err.message : "";
	if (msg === "PARENT_NOT_FOUND") {
		return {
			error: "La categoría padre indicada no existe",
			status: 400,
		};
	}
	if (msg === "PARENT_SELF_REFERENCE") {
		return {
			error: "Una categoría no puede ser padre de sí misma",
			status: 400,
		};
	}
	const status =
		typeof err === "object" && err !== null
			? (err as { status?: number }).status
			: undefined;
	if (
		typeof status === "number" &&
		status >= 400 &&
		status < 600 &&
		Number.isInteger(status)
	) {
		return {
			error: err instanceof Error ? err.message : "Error",
			status: status as ContentfulStatusCode,
		};
	}
	return null;
}

export interface CrudRouteConfig<TEntity> {
	baseRole: string;

	list: (db: DbFn, opts: Record<string, unknown>) => Promise<unknown>;
	getById: (db: DbFn, id: string) => Promise<TEntity | null>;
	create?: (db: DbFn, data: Record<string, unknown>) => Promise<unknown>;
	/** `user` es quien edita (p. ej. para el sello «Validado» de #420). */
	update?: (
		db: DbFn,
		id: string,
		data: Record<string, unknown>,
		user: User,
	) => Promise<void>;
	remove?: (db: DbFn, id: string) => Promise<void>;

	validateCreate?: (body: unknown) => ValidationResult;
	validateUpdate?: (body: unknown) => ValidationResult;
	/** Reglas de la edición que dependen de lo guardado (p. ej. el estado). */
	validateUpdateWith?: (
		entity: TEntity,
		body: Record<string, unknown>,
	) => ValidationResult;
	mergeOnUpdate?: boolean;

	canManage?: (user: User, entity: TEntity) => boolean;

	listFilters?: (
		user: User,
		params: Record<string, string | undefined>,
	) => Record<string, unknown>;
	prepareCreate?: (
		body: Record<string, unknown>,
		user: User,
	) => Record<string, unknown> | Promise<Record<string, unknown>>;

	afterCreate?: (
		user: User,
		result: unknown,
		data: Record<string, unknown>,
	) => Promise<void>;
	afterUpdate?: (
		user: User,
		id: string,
		entity: TEntity,
		data: Record<string, unknown>,
	) => Promise<void>;
	afterDelete?: (user: User, id: string, entity: TEntity) => Promise<void>;

	roles?: { create?: string; update?: string; remove?: string };
	notFoundMessage?: string;
}

export function buildCrudRoutes<TEntity>(
	config: CrudRouteConfig<TEntity>,
): Hono<AuthEnv> {
	const routes = new Hono<AuthEnv>();
	const db = () => getDb().db;
	const notFound = config.notFoundMessage ?? "No encontrado";

	routes.use("*", requireRole(config.baseRole));

	// GET / — list
	routes.get("/", async (c) => {
		const user = getCurrentUser(c);
		const { limit, offset, search } = parsePagination(c);
		const params: Record<string, string | undefined> = {};
		for (const [k, v] of new URL(c.req.url).searchParams) {
			params[k] = v;
		}
		const filters = config.listFilters?.(user, params) ?? {};
		return c.json(
			await config.list(db(), { limit, offset, search, ...filters }),
		);
	});

	// GET /:id — detail
	routes.get("/:id", async (c) => {
		const user = getCurrentUser(c);
		const id = c.req.param("id");
		if (!id) return c.json({ error: "Falta id" }, 400);
		const entity = await config.getById(db(), id);
		if (!entity) return c.json({ error: notFound }, 404);
		if (config.canManage && !config.canManage(user, entity)) {
			return c.json({ error: "Permisos insuficientes" }, 403);
		}
		return c.json(entity);
	});

	// POST / — create
	if (config.create) {
		// Se captura aquí, donde TypeScript ya sabe que existe: dentro del
		// handler el narrowing del `if` ya no aplica, porque se ejecuta después.
		const create = config.create;
		const handler = async (c: Context<AuthEnv>) => {
			const user = getCurrentUser(c);
			const body = await c.req.json();
			if (config.validateCreate) {
				const v = config.validateCreate(body);
				if (!v.valid)
					return c.json(
						{ error: "Validación fallida", details: v.errors },
						400,
					);
			}
			const data = config.prepareCreate
				? await config.prepareCreate(body, user)
				: body;
			try {
				const result = await create(db(), data);
				if (config.afterCreate) {
					try {
						await config.afterCreate(user, result, data);
					} catch {
						/* fire-and-forget */
					}
				}
				return c.json(result, 201);
			} catch (err: unknown) {
				const handled = jsonErrorFromCrudException(err);
				if (handled) {
					return c.json(crudErrorBody(err, handled), handled.status);
				}
				throw err;
			}
		};
		if (config.roles?.create) {
			routes.post("/", requireRole(config.roles.create), handler);
		} else {
			routes.post("/", handler);
		}
	}

	// PATCH /:id — update
	if (config.update) {
		const update = config.update;
		const handler = async (c: Context<AuthEnv>) => {
			const user = getCurrentUser(c);
			const id = c.req.param("id");
			if (!id) return c.json({ error: "Falta id" }, 400);
			const entity = await config.getById(db(), id);
			if (!entity) return c.json({ error: notFound }, 404);
			if (config.canManage && !config.canManage(user, entity)) {
				return c.json({ error: "Permisos insuficientes" }, 403);
			}
			const body = await c.req.json();
			if (config.validateUpdate) {
				const toValidate = config.mergeOnUpdate
					? { ...(entity as Record<string, unknown>), ...body }
					: body;
				const v = config.validateUpdate(toValidate);
				if (!v.valid)
					return c.json(
						{ error: "Validación fallida", details: v.errors },
						400,
					);
			}
			if (config.validateUpdateWith) {
				const v = config.validateUpdateWith(entity, body);
				if (!v.valid)
					return c.json(
						{ error: "Validación fallida", details: v.errors },
						400,
					);
			}
			try {
				await update(db(), id, body, user);
				if (config.afterUpdate) {
					try {
						await config.afterUpdate(user, id, entity, body);
					} catch {
						/* fire-and-forget */
					}
				}
				return c.json({ id, updated: true });
			} catch (err: unknown) {
				const handled = jsonErrorFromCrudException(err);
				if (handled) {
					return c.json(crudErrorBody(err, handled), handled.status);
				}
				throw err;
			}
		};
		if (config.roles?.update) {
			routes.patch("/:id", requireRole(config.roles.update), handler);
		} else {
			routes.patch("/:id", handler);
		}
	}

	// DELETE /:id — remove
	if (config.remove) {
		const remove = config.remove;
		const handler = async (c: Context<AuthEnv>) => {
			const user = getCurrentUser(c);
			const id = c.req.param("id");
			if (!id) return c.json({ error: "Falta id" }, 400);
			const entity = await config.getById(db(), id);
			if (!entity) return c.json({ error: notFound }, 404);
			if (config.canManage && !config.canManage(user, entity)) {
				return c.json({ error: "Permisos insuficientes" }, 403);
			}
			await remove(db(), id);
			if (config.afterDelete) {
				try {
					await config.afterDelete(user, id, entity);
				} catch {
					/* fire-and-forget */
				}
			}
			return c.json({ id, deleted: true });
		};
		if (config.roles?.remove) {
			routes.delete("/:id", requireRole(config.roles.remove), handler);
		} else {
			routes.delete("/:id", handler);
		}
	}

	return routes;
}
