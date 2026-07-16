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

/** Development/test transport. Never selected automatically in production. */
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
				auth: config.user ? { user: config.user, pass: config.pass } : undefined,
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

function parsePort(value: string | undefined): number {
	const port = Number(value ?? 587);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("SMTP_PORT debe ser un entero entre 1 y 65535");
	}
	return port;
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

export function resolveSmtpConfig(env: RuntimeEnv = process.env): SmtpConfig | null {
	const host = env.SMTP_HOST?.trim();
	if (!host) return null;

	const user = env.SMTP_USER?.trim() || undefined;
	const pass = env.SMTP_PASS || undefined;
	if ((user && !pass) || (!user && pass)) {
		throw new Error("SMTP_USER y SMTP_PASS deben configurarse juntos");
	}

	const configuredFrom = env.MAIL_FROM?.trim();
	if (env.NODE_ENV === "production" && !configuredFrom) {
		throw new Error("MAIL_FROM es obligatorio cuando SMTP se usa en producción");
	}

	return {
		host,
		port: parsePort(env.SMTP_PORT),
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
	const expiresIn = Number(env.EMAIL_VERIFICATION_EXPIRES_IN ?? 3600);
	if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
		throw new Error("EMAIL_VERIFICATION_EXPIRES_IN debe ser un entero positivo");
	}

	const smtp = resolveSmtpConfig(env);
	if (enabled && env.NODE_ENV === "production" && !smtp) {
		throw new Error(
			"AUTH_REQUIRE_EMAIL_VERIFICATION=true requiere SMTP_HOST en producción",
		);
	}

	return { enabled, expiresIn };
}

export function getEmailTransport(env: RuntimeEnv = process.env): EmailPort {
	const smtp = resolveSmtpConfig(env);
	if (smtp) return new SmtpEmailTransport(smtp);
	if (env.NODE_ENV === "production") {
		throw new Error("No hay transporte SMTP configurado para enviar correo");
	}
	return new LogEmailTransport();
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
