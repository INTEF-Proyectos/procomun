import nodemailer from "nodemailer";

export type EmailMessage = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

export type EmailPort = {
	sendEmail(message: EmailMessage): Promise<void>;
};

export type SmtpConfig = {
	host: string;
	port: number;
	secure: boolean;
	user?: string;
	pass?: string;
	from: string;
};

export type EmailVerificationConfig = {
	enabled: boolean;
	expiresIn: number;
};

type RuntimeEnv = Record<string, string | undefined>;

type MailTransporter = {
	sendMail(options: {
		from: string;
		to: string;
		subject: string;
		text: string;
		html?: string;
	}): Promise<unknown>;
};

const DEFAULT_FROM = "no-reply@procomun.local";

/**
 * LogEmailTransport is available only in development, test, or non-deployed CI.
 * An explicit deploy-like NODE_ENV always takes precedence over CI=true.
 */
export function allowsLogEmailTransport(env: RuntimeEnv): boolean {
	const nodeEnv = env.NODE_ENV?.trim();
	if (nodeEnv && nodeEnv !== "development" && nodeEnv !== "test") return false;
	if (nodeEnv === "development" || nodeEnv === "test") return true;
	// GitHub Actions and common CI runners set CI=true.
	return env.CI === "true" || env.CI === "1";
}

/** Development/test transport. Never selected automatically outside dev/test/CI. */
export class LogEmailTransport implements EmailPort {
	/**
	 * Los enlaces de los correos (verificación, recuperación) dan acceso a la
	 * cuenta y los logs de CI se publican: por defecto se tachan los tokens.
	 * `EMAIL_LOG_LINKS=true` los deja en claro para probar a mano en local.
	 */
	constructor(
		private readonly log: (line: string) => void = console.log,
		private readonly showLinks = false,
	) {}

	async sendEmail(message: EmailMessage): Promise<void> {
		const body = this.showLinks ? message.text : redactTokens(message.text);
		this.log(
			`[email] to=${message.to} subject="${message.subject}" body=${body}`,
		);
	}
}

/** Tacha `token=…` (query o fragmento) y `/reset-password/<token>`. */
export function redactTokens(text: string): string {
	return text
		.replace(/(token=)[^&\s#]+/g, "$1[REDACTED]")
		.replace(/(\/reset-password\/)[^/?#\s]+/g, "$1[REDACTED]");
}

export class SmtpEmailTransport implements EmailPort {
	private readonly transporter: MailTransporter;

	constructor(
		private readonly config: SmtpConfig,
		transporter?: MailTransporter,
	) {
		this.transporter =
			transporter ??
			(nodemailer.createTransport({
				host: config.host,
				port: config.port,
				secure: config.secure,
				auth: config.user
					? { user: config.user, pass: config.pass }
					: undefined,
			}) as unknown as MailTransporter);
	}

	async sendEmail(message: EmailMessage): Promise<void> {
		await this.transporter.sendMail({
			from: this.config.from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			html: message.html,
		});
	}
}

/**
 * Entero estricto con el mismo criterio que parseStrictBoolean: una variable
 * ausente o vacía cae al valor por defecto. Las plantillas de despliegue
 * interpolan variables sin definir como cadena vacía y `Number("")` es 0, que
 * antes tumbaba el arranque incluso con la verificación apagada.
 */
function parseStrictInteger(
	name: string,
	value: string | undefined,
	defaultValue: number,
	{ min, max }: { min: number; max: number },
): number {
	if (value === undefined || value.trim() === "") return defaultValue;
	const parsed = Number(value.trim());
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
	}
	return parsed;
}

function parseStrictBoolean(
	name: string,
	value: string | undefined,
	defaultValue: boolean,
): boolean {
	if (value === undefined || value.trim() === "") return defaultValue;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${name} debe ser true o false`);
}

export function resolveSmtpConfig(
	env: RuntimeEnv = process.env,
): SmtpConfig | null {
	const host = env.SMTP_HOST?.trim();
	if (!host) return null;

	const user = env.SMTP_USER?.trim() || undefined;
	const pass = env.SMTP_PASS || undefined;
	if ((user && !pass) || (!user && pass)) {
		throw new Error("SMTP_USER y SMTP_PASS deben configurarse juntos");
	}

	const configuredFrom = env.MAIL_FROM?.trim();
	// Fail closed for any environment that cannot use the log transport.
	if (!allowsLogEmailTransport(env) && !configuredFrom) {
		throw new Error(
			"MAIL_FROM es obligatorio cuando SMTP se usa fuera de desarrollo/test/CI",
		);
	}

	return {
		host,
		port: parseStrictInteger("SMTP_PORT", env.SMTP_PORT, 587, {
			min: 1,
			max: 65_535,
		}),
		secure: parseStrictBoolean("SMTP_SECURE", env.SMTP_SECURE, false),
		user,
		pass,
		from: configuredFrom || DEFAULT_FROM,
	};
}

export function resolveEmailVerificationConfig(
	env: RuntimeEnv = process.env,
): EmailVerificationConfig {
	const enabled = parseStrictBoolean(
		"AUTH_REQUIRE_EMAIL_VERIFICATION",
		env.AUTH_REQUIRE_EMAIL_VERIFICATION,
		false,
	);
	const expiresIn = parseStrictInteger(
		"EMAIL_VERIFICATION_EXPIRES_IN",
		env.EMAIL_VERIFICATION_EXPIRES_IN,
		3600,
		{ min: 1, max: 60 * 60 * 24 * 30 },
	);

	const smtp = resolveSmtpConfig(env);
	if (enabled && !smtp && !allowsLogEmailTransport(env)) {
		throw new Error(
			"AUTH_REQUIRE_EMAIL_VERIFICATION=true requiere SMTP_HOST fuera de desarrollo/test/CI",
		);
	}

	return { enabled, expiresIn };
}

/**
 * ¿Se puede mandar correo? Sin SMTP fuera de desarrollo/test/CI,
 * getEmailTransport lanza: los flujos que dependen del correo (recuperar la
 * contraseña) se apagan en lugar de prometer un envío que acaba en 500.
 */
export function hasEmailTransport(env: RuntimeEnv = process.env): boolean {
	return resolveSmtpConfig(env) !== null || allowsLogEmailTransport(env);
}

export function getEmailTransport(env: RuntimeEnv = process.env): EmailPort {
	const smtp = resolveSmtpConfig(env);
	if (smtp) return new SmtpEmailTransport(smtp);
	if (allowsLogEmailTransport(env)) {
		return new LogEmailTransport(console.log, env.EMAIL_LOG_LINKS === "true");
	}
	throw new Error("No hay transporte SMTP configurado para enviar correo");
}

/**
 * Envía sin que la respuesta HTTP espere al SMTP (revisión de #552).
 *
 * En `/change-email` Better Auth solo llama al envío cuando el destino está
 * libre: si la respuesta esperase al SMTP, su latencia delataría qué correos
 * tienen cuenta. El transporte se resuelve antes, así que una configuración
 * sin SMTP sigue fallando en el momento. Un fallo del envío se registra con un
 * resumen saneado: el error de nodemailer puede llevar destinatarios y el
 * mensaje lleva el enlace con el token.
 */
export function sendWithoutWaiting(
	port: EmailPort,
	message: EmailMessage,
	log: (line: string, summary: Record<string, unknown>) => void = console.error,
): void {
	port.sendEmail(message).catch((error: unknown) => {
		log("[email] No se pudo enviar un correo", {
			subject: message.subject,
			...summarizeEmailError(error),
		});
	});
}

/**
 * Opciones `emailVerification` de Better Auth derivadas del flag único.
 *
 * `sendOnSignIn` reenvía la verificación cuando alguien sin verificar acierta
 * su contraseña al entrar (Better Auth lo comprueba después de validar la
 * credencial, así que no es un vector de envío masivo). Sin esta opción, quien
 * pierda o deje caducar el correo inicial queda bloqueado hasta que exista la
 * UI de reenvío. Igual que `sendOnSignUp`, sigue al flag: apagado no genera
 * ninguna verificación automática.
 */
export function buildEmailVerificationOptions(
	config: EmailVerificationConfig,
	env: RuntimeEnv = process.env,
) {
	return {
		sendVerificationEmail: async ({
			user,
			url,
		}: {
			user: { email: string };
			url: string;
		}): Promise<void> => {
			// También verifica el correo nuevo de un cambio (#532): sin esperar.
			sendWithoutWaiting(
				getEmailTransport(env),
				buildVerificationEmail({ email: user.email, url }),
			);
		},
		sendOnSignUp: config.enabled,
		sendOnSignIn: config.enabled,
		autoSignInAfterVerification: true,
		expiresIn: config.expiresIn,
	};
}

export function buildVerificationEmail(params: {
	email: string;
	url: string;
}): EmailMessage {
	return {
		to: params.email,
		subject: "Verifica tu correo electrónico en Procomún",
		// #532: Better Auth usa este mismo correo para el alta y para verificar
		// el correo nuevo de un cambio. «Para activar tu cuenta» era falso en el
		// segundo caso, y quien cambia de correo se asustaría pensando que
		// alguien ha abierto una cuenta a su nombre.
		text:
			"Hola,\n\n" +
			"Confirma tu dirección de correo electrónico en Procomún abriendo este enlace:\n" +
			`${params.url}\n\n` +
			"Si no has creado una cuenta ni has pedido cambiar tu correo en Procomún, ignora este mensaje.",
	};
}

/**
 * Cambio de correo (issue #532).
 *
 * Better Auth 1.7, con el correo actual verificado, avisa primero a la
 * dirección **antigua**: el cambio no sigue hasta que el dueño lo confirma
 * desde su buzón, y después se verifica el correo nuevo. Es lo que protege a
 * la cuenta si alguien ha robado la sesión. Con el correo sin verificar (la
 * mayoría de las cuentas importadas, #488) va directo a verificar el nuevo.
 */
export function buildChangeEmailConfirmationEmail(params: {
	/** Dirección actual, a la que va este aviso. */
	email: string;
	newEmail: string;
	url: string;
}): EmailMessage {
	return {
		to: params.email,
		subject: "Confirma el cambio de correo en Procomún",
		text:
			"Hola,\n\n" +
			`Se ha pedido cambiar el correo de tu cuenta de Procomún a ${params.newEmail}. ` +
			"Todavía no ha cambiado nada.\n\n" +
			"Si lo has pedido tú, confirma el cambio abriendo este enlace. Después te enviaremos otro a la dirección nueva para verificarla:\n" +
			`${params.url}\n\n` +
			"Si no has pedido el cambio, ignora este mensaje y cambia tu contraseña: quien lo ha pedido ha entrado en tu cuenta.",
	};
}

/** Opciones `user.changeEmail` de Better Auth. */
export function buildChangeEmailOptions(
	env: RuntimeEnv = process.env,
	transport: (env: RuntimeEnv) => EmailPort = getEmailTransport,
) {
	return {
		// Sin transporte no se puede verificar el correo nuevo (#552): apagado,
		// y la pestaña Cuenta esconde el formulario.
		enabled: hasEmailTransport(env),
		// Nunca: una cuenta sin verificar podría pasar a otro correo sin
		// demostrar que lo controla.
		updateEmailWithoutVerification: false,
		sendChangeEmailConfirmation: async ({
			user,
			newEmail,
			url,
		}: {
			user: { email: string };
			newEmail: string;
			url: string;
		}): Promise<void> => {
			sendWithoutWaiting(
				transport(env),
				buildChangeEmailConfirmationEmail({
					email: user.email,
					newEmail,
					url,
				}),
			);
		},
	};
}

/**
 * Recuperación de contraseña (issue #531).
 *
 * ADR-0007 la daba por disponible «sin desarrollo adicional», pero
 * `sendResetPassword` no estaba configurado, así que no se enviaba nada. Es la
 * única vía de entrada de los usuarios importados cuya contraseña no se puede
 * traer (#488, formato de hash no admitido).
 */
export type PasswordResetConfig = {
	/** Segundos que vale el enlace. Da acceso a la cuenta: corto a propósito. */
	expiresIn: number;
};

export function resolvePasswordResetConfig(
	env: RuntimeEnv = process.env,
): PasswordResetConfig {
	return {
		expiresIn: parseStrictInteger(
			"PASSWORD_RESET_EXPIRES_IN",
			env.PASSWORD_RESET_EXPIRES_IN,
			3600,
			// Máximo un día: el enlace equivale a la contraseña mientras vale.
			{ min: 60, max: 60 * 60 * 24 },
		),
	};
}

/** «1 hora», «15 minutos»: lo que se le dice a quien recibe el correo. */
function formatExpiry(seconds: number): string {
	if (seconds % 3600 === 0) {
		const hours = seconds / 3600;
		return hours === 1 ? "1 hora" : `${hours} horas`;
	}
	const minutes = Math.round(seconds / 60);
	return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

export function buildPasswordResetEmail(params: {
	email: string;
	url: string;
	expiresIn: number;
}): EmailMessage {
	return {
		to: params.email,
		subject: "Restablece tu contraseña en Procomún",
		// Sin el correo en el cuerpo: ya va en el destinatario y así un reenvío
		// no lo reparte otra vez.
		text:
			"Hola,\n\n" +
			"Has pedido restablecer tu contraseña en Procomún. Abre este enlace para elegir una nueva:\n" +
			`${params.url}\n\n` +
			`El enlace vale ${formatExpiry(params.expiresIn)} y solo se puede usar una sola vez.\n\n` +
			"Si no has solicitado el cambio, ignora este mensaje: tu contraseña sigue siendo la misma.",
	};
}

const EMAIL_ERROR_FIELD_RE = /^[A-Za-z0-9_]{1,64}$/;

type EmailErrorSummary = {
	name?: string;
	code?: string;
	responseCode?: number;
};

/**
 * Lo que se puede registrar de un fallo de envío: la clase, el código
 * (ECONNECTION, EAUTH…) y el código SMTP. Nunca `message` ni `response`, que
 * pueden repetir el destinatario o el contenido del correo.
 */
export function summarizeEmailError(error: unknown): EmailErrorSummary {
	if (error === null || typeof error !== "object") return {};
	const fields = error as Record<string, unknown>;
	const summary: EmailErrorSummary = {};
	if (
		typeof fields.name === "string" &&
		EMAIL_ERROR_FIELD_RE.test(fields.name)
	) {
		summary.name = fields.name;
	}
	if (
		typeof fields.code === "string" &&
		EMAIL_ERROR_FIELD_RE.test(fields.code)
	) {
		summary.code = fields.code;
	}
	if (
		typeof fields.responseCode === "number" &&
		Number.isInteger(fields.responseCode)
	) {
		summary.responseCode = fields.responseCode;
	}
	return summary;
}

/**
 * Enlace del correo de recuperación (segunda revisión de #551).
 *
 * Better Auth da `/api/auth/reset-password/<token>?callbackURL=…`: valida el
 * token y redirige a `callbackURL?token=…`. Ese primer salto lleva el token en
 * la ruta de una petición a la API, y si el proxy falla el `error_log` de
 * nginx la escribe entera (no admite formato). Se manda directamente al
 * destino de la redirección, con el token en el fragmento (`#token=…`): la
 * pantalla es estática y el token solo vuelve a la API en el cuerpo del POST, que también lo valida. La URL de retorno se
 * resuelve igual que la redirección de Better Auth, que ya la comprueba contra
 * `trustedOrigins`. Lo que no tenga esa forma se deja tal cual.
 */
export function directResetLink(url: string): string {
	let link: URL;
	try {
		link = new URL(url);
	} catch {
		return url;
	}
	const token = /\/reset-password\/([^/]+)$/.exec(link.pathname)?.[1];
	if (!token) return url;
	const target = new URL(
		link.searchParams.get("callbackURL") || "/restablecer",
		link.origin,
	);
	// En el fragmento: el navegador no lo manda en la petición HTTP, así que
	// no llega a ningún proxy ni log (tercera revisión de #551).
	target.hash = new URLSearchParams({
		token: decodeURIComponent(token),
	}).toString();
	return target.href;
}

/** Opciones `emailAndPassword` de better-auth para el restablecimiento. */
export function buildPasswordResetOptions(
	config: PasswordResetConfig,
	env: RuntimeEnv = process.env,
	transport: (env: RuntimeEnv) => EmailPort = getEmailTransport,
) {
	return {
		sendResetPassword: async ({
			user,
			url,
		}: {
			user: { email: string };
			url: string;
		}): Promise<void> => {
			// Sin await (#551): better-auth solo llama aquí si la cuenta existe,
			// así que esperar al SMTP delataba por el tiempo de respuesta qué
			// correos están registrados. Un fallo se registra y no se propaga.
			void Promise.resolve()
				.then(() =>
					transport(env).sendEmail(
						buildPasswordResetEmail({
							email: user.email,
							url: directResetLink(url),
							expiresIn: config.expiresIn,
						}),
					),
				)
				.catch((error: unknown) => {
					// Sin el error entero: el de SMTP puede llevar el destinatario
					// o la respuesta del servidor, y el enlace da acceso a la cuenta.
					console.error(
						"[email] no se ha enviado el restablecimiento",
						summarizeEmailError(error),
					);
				});
		},
		resetPasswordTokenExpiresIn: config.expiresIn,
	};
}
