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
	constructor(private readonly log: (line: string) => void = console.log) {}

	async sendEmail(message: EmailMessage): Promise<void> {
		this.log(
			`[email] to=${message.to} subject="${message.subject}" body=${message.text}`,
		);
	}
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

export function getEmailTransport(env: RuntimeEnv = process.env): EmailPort {
	const smtp = resolveSmtpConfig(env);
	if (smtp) return new SmtpEmailTransport(smtp);
	if (allowsLogEmailTransport(env)) return new LogEmailTransport();
	throw new Error("No hay transporte SMTP configurado para enviar correo");
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
			await getEmailTransport(env).sendEmail(
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
		text:
			"Hola,\n\n" +
			"Para activar tu cuenta en Procomún confirma tu correo electrónico abriendo este enlace:\n" +
			`${params.url}\n\n` +
			"Si no has solicitado esta cuenta, ignora este mensaje.",
	};
}
