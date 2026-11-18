import { type FormEvent, useEffect, useState } from "react";
import "../../lib/paraglide-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { url } from "../../lib/paths.ts";
import * as m from "../../paraglide/messages.js";
import "./LoginIsland.css";

/**
 * Recuperación de contraseña (issue #531).
 *
 * ADR-0007 la daba por disponible, pero no estaba conectada. Es la única vía
 * de entrada de los usuarios importados cuya contraseña no se pudo traer
 * (#488, formato de hash no admitido).
 *
 * Dos pantallas: pedir el enlace y elegir la contraseña nueva. La primera
 * responde **siempre lo mismo**, exista o no la cuenta, para que no sirva de
 * comprobador de correos registrados.
 */

/**
 * Token del enlace, o `null` si no viene (enlace caducado, ya usado o roto).
 * Va en el fragmento (`#token=…`), que el navegador no manda en la petición
 * HTTP; la query se acepta solo para los correos enviados antes del cambio.
 */
export function readResetToken(hash: string, search = ""): string | null {
	const token =
		new URLSearchParams(hash.replace(/^#/, "")).get("token") ||
		new URLSearchParams(search).get("token");
	return token && token.length > 0 ? token : null;
}

/** Mismo mínimo que `minPasswordLength` de better-auth. */
const MIN_PASSWORD_LENGTH = 8;

export type NewPasswordProblem = "too_short" | "mismatch";

/**
 * Se comprueba la longitud antes que la coincidencia: decir «no coinciden»
 * cuando además es corta esconde el problema real.
 */
export function validateNewPassword(
	password: string,
	repeated: string,
): NewPasswordProblem | null {
	if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
	if (password !== repeated) return "mismatch";
	return null;
}

export function ForgotPasswordIsland() {
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError("");
		setSubmitting(true);
		try {
			const api = await getApiClient();
			const result = await api.requestPasswordReset(email);
			// El servidor responde igual exista o no la cuenta; ok: false es red,
			// recuperación apagada o límite de peticiones (#551).
			if (result.ok) setSent(true);
			else setError(result.error ?? m.auth_forgot_failed());
		} catch {
			setError(m.auth_connection_error());
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="login-page">
			<div className="login-card">
				<div className="login-header">
					<h1 className="login-title">{m.auth_forgot_title()}</h1>
					<p className="login-subtitle">{m.auth_forgot_subtitle()}</p>
				</div>

				{sent ? (
					<p className="login-dev-info" role="status">
						{m.auth_forgot_sent()}
					</p>
				) : (
					<form onSubmit={handleSubmit}>
						{error && (
							<div className="login-error" role="alert">
								{error}
							</div>
						)}
						<label className="login-field">
							<span>{m.auth_email_label()}</span>
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								autoComplete="email"
								required
							/>
						</label>
						<button
							type="submit"
							className="login-submit"
							disabled={submitting}
						>
							{m.auth_forgot_submit()}
						</button>
					</form>
				)}

				<p className="login-footer">
					<a href={url("login")}>{m.auth_forgot_back()}</a>
				</p>
			</div>
		</div>
	);
}

export function ResetPasswordIsland({
	hash = typeof window === "undefined" ? "" : window.location.hash,
	search = typeof window === "undefined" ? "" : window.location.search,
}: {
	hash?: string;
	search?: string;
}) {
	// Se lee una vez: tras quitarlo de la URL ya no se podría volver a leer.
	const [token] = useState(() => readResetToken(hash, search));
	useEffect(() => {
		// Fuera de la URL para que no quede en el historial ni en un marcador.
		if (token && (window.location.hash || window.location.search)) {
			history.replaceState(null, "", window.location.pathname);
		}
	}, [token]);
	const [password, setPassword] = useState("");
	const [repeated, setRepeated] = useState("");
	const [error, setError] = useState("");
	const [done, setDone] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		const problem = validateNewPassword(password, repeated);
		if (problem) {
			setError(
				problem === "too_short"
					? m.auth_reset_too_short()
					: m.auth_reset_mismatch(),
			);
			return;
		}
		if (!token) return;

		setError("");
		setSubmitting(true);
		try {
			const api = await getApiClient();
			const result = await api.resetPassword(token, password);
			if (result.ok) setDone(true);
			else setError(result.error ?? m.auth_connection_error());
		} catch {
			// #551: sin esto un fallo de red no enseñaba nada.
			setError(m.auth_connection_error());
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="login-page">
			<div className="login-card">
				<div className="login-header">
					<h1 className="login-title">{m.auth_reset_title()}</h1>
					{token && !done && (
						<p className="login-subtitle">{m.auth_reset_subtitle()}</p>
					)}
				</div>

				{!token && (
					<div className="login-error" role="alert">
						{m.auth_reset_no_token()}
					</div>
				)}

				{token && done && (
					<p className="login-dev-info" role="status">
						{m.auth_reset_done()}
					</p>
				)}

				{token && !done && (
					<form onSubmit={handleSubmit}>
						{error && (
							<div className="login-error" role="alert">
								{error}
							</div>
						)}
						<label className="login-field">
							<span>{m.auth_reset_password()}</span>
							<input
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="new-password"
								minLength={MIN_PASSWORD_LENGTH}
								required
							/>
						</label>
						<label className="login-field">
							<span>{m.auth_reset_repeat()}</span>
							<input
								type="password"
								value={repeated}
								onChange={(e) => setRepeated(e.target.value)}
								autoComplete="new-password"
								minLength={MIN_PASSWORD_LENGTH}
								required
							/>
						</label>
						<button
							type="submit"
							className="login-submit"
							disabled={submitting}
						>
							{m.auth_reset_submit()}
						</button>
					</form>
				)}

				<p className="login-footer">
					<a href={url("login")}>{m.auth_forgot_back()}</a>
				</p>
			</div>
		</div>
	);
}
