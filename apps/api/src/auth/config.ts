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
	resolveEmailVerificationConfig,
} from "../email/transport.ts";
import { AUTH_DEFAULT_COOKIE_ATTRIBUTES } from "./cookie-config.ts";
import {
	legacyAwarePasswordOptions,
	upgradeLegacyPasswordHash,
} from "./legacy-password.ts";
import { ac, admin, author, curator, editor, reader } from "./permissions.ts";
import { getAuthBaseUrl, getFrontendUrl } from "./urls.ts";

const frontendUrl = getFrontendUrl();
const oidcEnabled = process.env.OIDC_ENABLED === "true";
const emailVerificationConfig = resolveEmailVerificationConfig(process.env);

/** Mensaje al intentar entrar con una cuenta bloqueada (#456). */
export const BLOCKED_USER_MESSAGE =
	"Tu cuenta está bloqueada. Si crees que es un error, contacta con la administración de Procomún.";

export const auth = betterAuth({
	baseURL: getAuthBaseUrl(),
	trustedOrigins: [frontendUrl],
	database: drizzleAdapter(getDb().db, { provider: "pg", schema: pgSchema }),
	basePath: "/api/auth",
	advanced: {
		defaultCookieAttributes: AUTH_DEFAULT_COOKIE_ATTRIBUTES,
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user) => ({
					data: {
						...user,
						email: user.email.trim().toLowerCase(),
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
						await upgradeLegacyPasswordHash(ctx.context.internalAdapter, {
							userId: newSession.user.id,
							password,
						});
					} catch (error) {
						// El inicio de sesión ya es válido; se reintentará en el siguiente.
						ctx.context.logger.error(
							"No se pudo actualizar el hash de una contraseña heredada",
							error,
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
	emailVerification: buildEmailVerificationOptions(emailVerificationConfig),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		requireEmailVerification: emailVerificationConfig.enabled,
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
			defaultRole: "author",
			bannedUserMessage: BLOCKED_USER_MESSAGE,
		}),
		...(oidcEnabled
			? [
					genericOAuth({
						config: [
							{
								providerId: "oidc",
								clientId: process.env.OIDC_CLIENT_ID ?? "",
								clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
								discoveryUrl: process.env.OIDC_ISSUER
									? `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`
									: "",
								scopes: (
									process.env.OIDC_SCOPE ?? "openid email profile"
								).split(" "),
								pkce: true,
							},
						],
					}),
				]
			: []),
	],
});

export type Auth = typeof auth;
