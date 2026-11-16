import { summarizeDbStepError } from "@procomun/db/db-errors";
import * as pgSchema from "@procomun/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin as adminPlugin, genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { logActivity } from "../activity/log.ts";
import { getDb } from "../db.ts";
import {
	buildEmailVerificationOptions,
	buildPasswordResetOptions,
	hasEmailTransport,
	resolveEmailVerificationConfig,
	resolvePasswordResetConfig,
} from "../email/transport.ts";
import { AUTH_DEFAULT_COOKIE_ATTRIBUTES } from "./cookie-config.ts";
import {
	type LegacyPasswordAdapter,
	legacyAwarePasswordOptions,
	replaceLegacyPasswordHash,
	upgradeLegacyPasswordHash,
} from "./legacy-password.ts";
import { ac, admin, author, curator, editor, reader } from "./permissions.ts";
import { REGISTRATION_ROLE, resolveNewUserRole } from "./registration-role.ts";
import { getAuthBaseUrl, getFrontendUrl } from "./urls.ts";

/** Mensaje al intentar entrar con una cuenta bloqueada (#456). */
export const BLOCKED_USER_MESSAGE =
	"Tu cuenta está bloqueada. Si crees que es un error, contacta con la administración de Procomún.";

/**
 * Operaciones de base de datos que usa la actualización de hashes heredados:
 * la lectura, con el adaptador de better-auth; la escritura, condicional
 * (#488), porque el adaptador solo sabe escribir sin condiciones.
 */
export function legacyPasswordAdapter(
	internalAdapter: Pick<LegacyPasswordAdapter, "findAccounts">,
): LegacyPasswordAdapter {
	return {
		findAccounts: (userId) => internalAdapter.findAccounts(userId),
		replacePasswordHash: (input) =>
			replaceLegacyPasswordHash(getDb().db, input),
	};
}

// Recibe el entorno para que los tests monten una instancia con su propio
// proveedor OIDC (#515, #527); la aplicación usa `auth`, creada con process.env.
export function createAuth(env: NodeJS.ProcessEnv = process.env) {
	const frontendUrl = getFrontendUrl(env);
	const oidcEnabled = env.OIDC_ENABLED === "true";
	const emailVerificationConfig = resolveEmailVerificationConfig(env);
	const passwordResetConfig = resolvePasswordResetConfig(env);

	return betterAuth({
		baseURL: getAuthBaseUrl(env),
		trustedOrigins: [frontendUrl],
		database: drizzleAdapter(getDb().db, { provider: "pg", schema: pgSchema }),
		basePath: "/api/auth",
		advanced: {
			defaultCookieAttributes: AUTH_DEFAULT_COOKIE_ATTRIBUTES,
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user, ctx) => ({
						data: {
							...user,
							email: user.email.trim().toLowerCase(),
							// El registro no elige rol (#515): ver registration-role.ts.
							role: resolveNewUserRole(
								(user as { role?: unknown }).role,
								ctx?.path,
							),
						},
					}),
				},
			},
			session: {
				create: {
					// Una cuenta bloqueada no inicia sesión (#456). El plugin admin ya
					// lo impide con `banned`; esto cubre también las que solo tienen
					// is_active = false (desactivadas antes de unificar el estado).
					before: async (session) => {
						const rows = await getDb()
							.db.select({ isActive: pgSchema.user.isActive })
							.from(pgSchema.user)
							.where(eq(pgSchema.user.id, session.userId))
							.limit(1);
						if (rows[0]?.isActive === false) {
							throw APIError.from("FORBIDDEN", {
								message: BLOCKED_USER_MESSAGE,
								code: "BANNED_USER",
							});
						}
					},
					after: async (session) => {
						await logActivity({
							userId: session.userId,
							type: "auth_login",
							description: "Inicio de sesión exitoso",
							metadata: { sessionId: session.id },
						});
					},
				},
			},
		},
		hooks: {
			after: createAuthMiddleware(async (ctx) => {
				// Usuarios importados del Procomún anterior (issue #456): tras entrar
				// con la contraseña de siempre, su hash antiguo pasa al formato nuevo.
				const newSession = ctx.context.newSession;
				if (ctx.path === "/sign-in/email" && newSession) {
					const password = (ctx.body as { password?: unknown } | undefined)
						?.password;
					if (typeof password === "string") {
						try {
							await upgradeLegacyPasswordHash(
								legacyPasswordAdapter(ctx.context.internalAdapter),
								{
									userId: newSession.user.id,
									password,
								},
							);
						} catch (error) {
							// El inicio de sesión ya es válido; se reintenta en el siguiente.
							// Nunca el error entero: el de Drizzle lleva la consulta y sus
							// parámetros, es decir, los hashes (#488).
							const { code, sqlState } = summarizeDbStepError(error);
							ctx.context.logger.error(
								"No se pudo actualizar el hash de una contraseña heredada",
								{ code, ...(sqlState ? { sqlState } : {}) },
							);
						}
					}
				}
				if (ctx.path === "/sign-out") {
					const session = ctx.context.session;
					if (session?.session) {
						await logActivity({
							userId: session.session.userId,
							type: "auth_logout",
							description: "Cierre de sesión",
							metadata: { sessionId: session.session.id },
						});
					}
				}
			}),
		},
		emailVerification: buildEmailVerificationOptions(
			emailVerificationConfig,
			env,
		),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
			requireEmailVerification: emailVerificationConfig.enabled,
			// #531: ADR-0007 daba la recuperación por disponible, pero
			// sendResetPassword no estaba puesto y no se enviaba nada. Es la
			// única vía de entrada de los importados sin contraseña traída (#488).
			// #551: sin transporte de correo no se ofrece (la interfaz lo sabe
			// por /api/v1/config). Restablecer cierra todas las sesiones: quien
			// lo hace suele temer que otro tenga la contraseña vieja.
			...(hasEmailTransport(env)
				? buildPasswordResetOptions(passwordResetConfig, env)
				: {}),
			revokeSessionsOnPasswordReset: true,
			password: legacyAwarePasswordOptions,
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
		},
		plugins: [
			adminPlugin({
				ac,
				roles: {
					admin,
					curator,
					editor,
					author,
					reader,
				},
				defaultRole: REGISTRATION_ROLE,
				bannedUserMessage: BLOCKED_USER_MESSAGE,
			}),
			...(oidcEnabled
				? [
						genericOAuth({
							config: [
								{
									providerId: "oidc",
									clientId: env.OIDC_CLIENT_ID ?? "",
									clientSecret: env.OIDC_CLIENT_SECRET ?? "",
									discoveryUrl: env.OIDC_ISSUER
										? `${env.OIDC_ISSUER}/.well-known/openid-configuration`
										: "",
									scopes: (env.OIDC_SCOPE ?? "openid email profile").split(" "),
									pkce: true,
								},
							],
						}),
					]
				: []),
		],
	});
}

export const auth = createAuth();

export type Auth = typeof auth;
