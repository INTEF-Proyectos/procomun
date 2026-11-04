import { type FormEvent, useEffect, useState } from "react";
import { getApiClient } from "../../lib/get-api-client.ts";
import {
	MIN_PASSWORD_LENGTH,
	passwordStrength,
} from "../../lib/password-strength.ts";
import * as m from "../../paraglide/messages.js";
import "./AccountTab.css";

/**
 * Pestaña «Cuenta» del perfil (issue #532): cambiar la contraseña y el correo.
 *
 * En las cuentas de acceso institucional (OIDC) no se ofrece ninguna de las
 * dos: la contraseña y el correo se gestionan en el proveedor de identidad, y
 * un correo cambiado aquí se desalinearía con el suyo.
 */

export type PasswordChangeProblem = "too_short" | "mismatch" | "same";

/** Longitud antes que coincidencia: «no coinciden» esconde que es corta. */
export function validatePasswordChange(
	current: string,
	next: string,
	repeated: string,
): PasswordChangeProblem | null {
	if (next.length < MIN_PASSWORD_LENGTH) return "too_short";
	if (next !== repeated) return "mismatch";
	if (next === current) return "same";
	return null;
}

/** Better Auth guarda el correo normalizado: se compara igual. */
export function validateEmailChange(
	current: string,
	next: string,
): "same" | null {
	return next.trim().toLowerCase() === current.trim().toLowerCase()
		? "same"
		: null;
}

const PASSWORD_PROBLEM_MESSAGE: Record<PasswordChangeProblem, () => string> = {
	too_short: m.account_password_too_short,
	mismatch: m.account_password_mismatch,
	same: m.account_password_same,
};

function StrengthMeter({ password }: { password: string }) {
	const level = passwordStrength(password);
	const label =
		level === "strong"
			? m.account_strength_strong()
			: level === "fair"
				? m.account_strength_fair()
				: level === "weak"
					? m.account_strength_weak()
					: "";
	return (
		// Se anuncia sin robar el foco mientras se escribe.
		<p className="account-strength" aria-live="polite" data-level={level}>
			{password && label ? `${m.account_strength_label()}: ${label}` : ""}
		</p>
	);
}

function PasswordForm() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [repeated, setRepeated] = useState("");
	const [error, setError] = useState("");
	const [done, setDone] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setDone(false);
		const problem = validatePasswordChange(current, next, repeated);
		if (problem) {
			setError(PASSWORD_PROBLEM_MESSAGE[problem]());
			return;
		}
		setError("");
		setSubmitting(true);
		try {
			const api = await getApiClient();
			const result = await api.changePassword(current, next);
			if (result.ok) {
				setDone(true);
				setCurrent("");
				setNext("");
				setRepeated("");
			} else {
				setError(
					result.error === "wrong_current_password"
						? m.account_password_wrong_current()
						: (result.error ?? ""),
				);
			}
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form className="account-section" onSubmit={handleSubmit}>
			<h3>{m.account_password_heading()}</h3>
			{error && (
				<p className="account-error" role="alert">
					{error}
				</p>
			)}
			{done && (
				<p className="account-done" role="status">
					{m.account_password_done()}
				</p>
			)}
			<label className="account-field">
				<span>{m.account_password_current()}</span>
				<input
					type="password"
					value={current}
					onChange={(e) => setCurrent(e.target.value)}
					autoComplete="current-password"
					required
				/>
			</label>
			<label className="account-field">
				<span>{m.account_password_new()}</span>
				<input
					type="password"
					value={next}
					onChange={(e) => setNext(e.target.value)}
					autoComplete="new-password"
					minLength={MIN_PASSWORD_LENGTH}
					required
				/>
			</label>
			<StrengthMeter password={next} />
			<label className="account-field">
				<span>{m.account_password_repeat()}</span>
				<input
					type="password"
					value={repeated}
					onChange={(e) => setRepeated(e.target.value)}
					autoComplete="new-password"
					minLength={MIN_PASSWORD_LENGTH}
					required
				/>
			</label>
			<button type="submit" className="account-submit" disabled={submitting}>
				{m.account_password_submit()}
			</button>
		</form>
	);
}

function EmailForm({ email }: { email: string }) {
	const [next, setNext] = useState("");
	const [error, setError] = useState("");
	const [sent, setSent] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		if (validateEmailChange(email, next) === "same") {
			setError(m.account_email_same());
			return;
		}
		setError("");
		setSubmitting(true);
		try {
			const api = await getApiClient();
			const result = await api.changeEmail(next.trim());
			if (result.ok) setSent(true);
			else setError(result.error ?? "");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form className="account-section" onSubmit={handleSubmit}>
			<h3>{m.account_email_heading()}</h3>
			<p className="account-current">{m.account_email_current({ email })}</p>
			{error && (
				<p className="account-error" role="alert">
					{error}
				</p>
			)}
			{sent ? (
				// No ha cambiado nada todavía: hay que verificar el correo nuevo.
				<p className="account-done" role="status">
					{m.account_email_sent()}
				</p>
			) : (
				<>
					<label className="account-field">
						<span>{m.account_email_new()}</span>
						<input
							type="email"
							value={next}
							onChange={(e) => setNext(e.target.value)}
							autoComplete="email"
							required
						/>
					</label>
					<button
						type="submit"
						className="account-submit"
						disabled={submitting}
					>
						{m.account_email_submit()}
					</button>
				</>
			)}
		</form>
	);
}

export function AccountTab({
	email,
	initialHasPassword,
}: {
	email: string;
	/** Para los tests; en la aplicación se averigua al montar. */
	initialHasPassword?: boolean;
}) {
	const [hasPassword, setHasPassword] = useState<boolean | undefined>(
		initialHasPassword,
	);

	useEffect(() => {
		if (initialHasPassword !== undefined) return;
		void (async () => {
			const api = await getApiClient();
			setHasPassword(await api.hasPasswordAccount());
		})();
	}, [initialHasPassword]);

	// Mientras no se sabe qué cuenta es, nada: ofrecer cambiar una contraseña
	// que no existe acaba en error.
	if (hasPassword === undefined) return null;

	if (!hasPassword) {
		return <p className="account-oidc">{m.account_oidc_notice()}</p>;
	}

	return (
		<div className="account-tab">
			<PasswordForm />
			<EmailForm email={email} />
		</div>
	);
}
