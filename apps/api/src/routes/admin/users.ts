import * as repo from "@procomun/db/repository";
import { ROLE_LEVELS } from "@procomun/db/validation";
import { Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import { auth } from "../../auth/config.ts";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getCurrentUser, hasMinRole } from "../../auth/roles.ts";
import { getDb } from "../../db.ts";
import { parsePagination } from "../../http/pagination.ts";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD_LENGTH = 8;

const userRoutes = new Hono<AuthEnv>();

userRoutes.get("/", async (c) => {
	const user = getCurrentUser(c);
	const { limit, offset, search } = parsePagination(c);
	const role = c.req.query("role") ?? undefined;

	if (hasMinRole(user.role, "admin")) {
		return c.json(
			await repo.listUsers(getDb().db, { limit, offset, search, role }),
		);
	}

	const ownUsers = await repo.listUsers(getDb().db, {
		limit,
		offset,
		id: user.id,
	});
	if (ownUsers.total > 0) return c.json(ownUsers);

	return c.json({
		data: [
			{
				id: user.id,
				email: user.email ?? "",
				name: user.name ?? null,
				role: user.role ?? "reader",
				isActive: true,
			},
		],
		total: 1,
		limit,
		offset,
	});
});

// DEF-019: alta de usuarios desde administración. Crea el usuario sin iniciar
// sesión como él (a diferencia del endpoint público de registro de Better Auth),
// de modo que la sesión del administrador permanece intacta.
userRoutes.post("/", async (c) => {
	const currentUser = getCurrentUser(c);
	if (!hasMinRole(currentUser.role, "admin")) {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}

	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") {
		return c.json({ error: "Cuerpo de la petición inválido" }, 400);
	}

	const email =
		typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	const name =
		typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
	const role =
		typeof body.role === "string" && body.role in ROLE_LEVELS
			? body.role
			: "author";

	const details: { field: string; message: string }[] = [];
	if (!EMAIL_PATTERN.test(email)) {
		details.push({ field: "email", message: "Correo electrónico inválido" });
	}
	if (password.length < MIN_PASSWORD_LENGTH) {
		details.push({
			field: "password",
			message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
		});
	}
	if (details.length > 0) {
		return c.json({ error: "Datos inválidos", details }, 400);
	}

	const db = getDb().db;
	const existing = await repo.getUserByEmail(db, email);
	if (existing) {
		return c.json({ error: "El correo electrónico ya está registrado" }, 409);
	}

	const passwordHash = await (await auth.$context).password.hash(password);
	const created = await repo.createUserWithCredentials(db, {
		email,
		name,
		role,
		passwordHash,
	});

	await logActivity({
		userId: currentUser.id,
		type: "admin_user_created",
		description: `Creado usuario ${email}`,
		metadata: { targetUserId: created?.id, role },
	});

	return c.json({ id: created?.id, created: true }, 201);
});

userRoutes.get("/:id", async (c) => {
	const currentUser = getCurrentUser(c);
	const { id } = c.req.param();
	if (!hasMinRole(currentUser.role, "admin") && currentUser.id !== id) {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}

	const found = await repo.getUserById(getDb().db, id);
	if (!found && currentUser.id === id) {
		return c.json({
			id: currentUser.id,
			email: currentUser.email ?? "",
			name: currentUser.name ?? null,
			role: currentUser.role ?? "reader",
			isActive: true,
		});
	}
	if (!found) return c.json({ error: "Usuario no encontrado" }, 404);
	return c.json(found);
});

userRoutes.patch("/:id", async (c) => {
	const currentUser = getCurrentUser(c);
	const { id } = c.req.param();
	if (!hasMinRole(currentUser.role, "admin") && currentUser.id !== id) {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}

	const existing = await repo.getUserById(getDb().db, id);
	if (!existing) return c.json({ error: "Usuario no encontrado" }, 404);

	const body = await c.req.json();
	const updates: {
		name?: string | null;
		bio?: string | null;
		role?: string;
		isActive?: boolean;
	} = {};
	if ("name" in body)
		updates.name = typeof body.name === "string" ? body.name : null;
	// DEF-004 (#201): el perfil debe persistir también el campo "sobre mí" (bio).
	if ("bio" in body)
		updates.bio = typeof body.bio === "string" ? body.bio : null;
	if (hasMinRole(currentUser.role, "admin")) {
		if (typeof body.role === "string" && body.role in ROLE_LEVELS)
			updates.role = body.role;
		if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
	}
	if (updates.isActive === false && id === currentUser.id) {
		return c.json({ error: "No puedes bloquear tu propia cuenta" }, 400);
	}

	await repo.updateUser(getDb().db, id, updates);

	if (updates.role || updates.isActive !== undefined) {
		await logActivity({
			userId: currentUser.id,
			type: "admin_user_updated",
			description: `Actualizado usuario ${existing.email} (${id})`,
			metadata: {
				targetUserId: id,
				updates,
				previousRole: existing.role,
				previousActive: existing.isActive,
			},
		});
	}

	return c.json({ id, updated: true });
});

// DEF-020: baja de usuarios desde administración (baja lógica). Tras completarse,
// el usuario deja de aparecer en el listado.
userRoutes.delete("/:id", async (c) => {
	const currentUser = getCurrentUser(c);
	if (!hasMinRole(currentUser.role, "admin")) {
		return c.json({ error: "Permisos insuficientes" }, 403);
	}

	const { id } = c.req.param();
	if (id === currentUser.id) {
		return c.json({ error: "No puedes eliminar tu propia cuenta" }, 400);
	}

	const existing = await repo.getUserById(getDb().db, id);
	if (!existing) {
		return c.json({ error: "Usuario no encontrado" }, 404);
	}

	await repo.softDeleteUser(getDb().db, id);

	await logActivity({
		userId: currentUser.id,
		type: "admin_user_deleted",
		description: `Eliminado usuario ${existing.email} (${id})`,
		metadata: { targetUserId: id, previousRole: existing.role },
	});

	return c.json({ id, deleted: true });
});

export { userRoutes };
