import {
	COUNTRY_CODES,
	PROFILE_DETAIL_FIELDS,
	PROFILE_LIMITS,
	type ProfileDetailField,
	type ProfileDetails,
} from "@procomun/db/user-profile";
import type { ProfileFieldError } from "../../lib/api-client.ts";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";

/**
 * Perfil ampliado (#533): centro, localidad y redes. Son privados: solo los ve
 * su dueño en /perfil hasta que #504 decida qué se muestra.
 */

/** Código de error de la API por campo: `name`, `bio` o un campo del perfil. */
export type ProfileFormErrors = Partial<
	Record<"name" | "bio" | ProfileDetailField, string>
>;

const URL_FIELDS = new Set<ProfileDetailField>([
	"educationalCenterUrl",
	"website",
]);

function fieldLabel(field: ProfileDetailField): string {
	switch (field) {
		case "countryCode":
			return m.profile_details_country();
		case "locality":
			return m.profile_details_locality();
		case "educationalCenter":
			return m.profile_details_educational_center();
		case "educationalCenterUrl":
			return m.profile_details_educational_center_url();
		case "website":
			return m.profile_details_website();
		case "facebook":
			return m.profile_details_facebook();
		case "twitter":
			return m.profile_details_twitter();
		case "linkedin":
			return m.profile_details_linkedin();
	}
}

export function profileErrorMessage(code: string): string {
	switch (code) {
		case "required":
			return m.profile_error_required();
		case "too_long":
			return m.profile_error_too_long();
		case "invalid_url":
			return m.profile_error_invalid_url();
		case "invalid_country":
			return m.profile_error_invalid_country();
		default:
			return m.profile_error_invalid_type();
	}
}

/** Reparte los errores de la API (`name`, `bio`, `profile.<campo>`) por campo. */
export function errorsByField(
	errors: readonly ProfileFieldError[],
): ProfileFormErrors {
	const result: ProfileFormErrors = {};
	for (const { field, code } of errors) {
		const key = field.replace(/^profile\./, "") as keyof ProfileFormErrors;
		result[key] ??= code;
	}
	return result;
}

/** Países con su nombre en el idioma de la interfaz, por orden alfabético. */
export function countryOptions(
	locale: string,
): Array<{ code: string; name: string }> {
	const names = new Intl.DisplayNames([locale], { type: "region" });
	return COUNTRY_CODES.map((code) => ({
		code,
		name: names.of(code) ?? code,
	})).sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function countryName(code: string, locale: string): string {
	try {
		return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** Mensaje de error de un campo, enlazado con `aria-describedby`. */
export function FieldError({ id, code }: { id: string; code?: string }) {
	if (!code) return null;
	return (
		<p id={id} className="dashboard-field-error">
			{profileErrorMessage(code)}
		</p>
	);
}

interface ProfileDetailsFieldsProps {
	value: ProfileDetails;
	onChange: (value: ProfileDetails) => void;
	errors: ProfileFormErrors;
	disabled?: boolean;
}

export function ProfileDetailsFields({
	value,
	onChange,
	errors,
	disabled = false,
}: ProfileDetailsFieldsProps) {
	const locale = getLocale();
	const set = (field: ProfileDetailField, next: string) =>
		onChange({ ...value, [field]: next });

	return (
		<fieldset
			className="dashboard-details-fieldset"
			aria-describedby="profile-details-note"
		>
			<legend>{m.profile_details_title()}</legend>
			<p id="profile-details-note" className="dashboard-details-note">
				<span className="material-symbols-outlined" aria-hidden="true">
					lock
				</span>
				{m.profile_details_private_note()}
			</p>
			<div className="dashboard-details-grid">
				{PROFILE_DETAIL_FIELDS.map((field) => {
					const id = `profile-${field}`;
					const errorId = `${id}-error`;
					const error = errors[field];
					const common = {
						id,
						disabled,
						"aria-invalid": error ? true : undefined,
						"aria-describedby": error ? errorId : undefined,
					};
					return (
						<div className="dashboard-edit-field" key={field}>
							<label htmlFor={id}>{fieldLabel(field)}</label>
							{field === "countryCode" ? (
								<select
									{...common}
									value={value.countryCode ?? ""}
									onChange={(e) => set(field, e.target.value)}
									autoComplete="country"
								>
									<option value="">{m.profile_details_country_none()}</option>
									{countryOptions(locale).map((option) => (
										<option key={option.code} value={option.code}>
											{option.name}
										</option>
									))}
								</select>
							) : (
								<input
									{...common}
									type={URL_FIELDS.has(field) ? "url" : "text"}
									inputMode={URL_FIELDS.has(field) ? "url" : undefined}
									value={value[field] ?? ""}
									onChange={(e) => set(field, e.target.value)}
									maxLength={
										URL_FIELDS.has(field)
											? PROFILE_LIMITS.url
											: PROFILE_LIMITS.shortText
									}
									autoComplete={
										field === "locality"
											? "address-level2"
											: field === "educationalCenter"
												? "organization"
												: field === "website"
													? "url"
													: "off"
									}
									placeholder={URL_FIELDS.has(field) ? "https://" : undefined}
								/>
							)}
							<FieldError id={errorId} code={error} />
						</div>
					);
				})}
			</div>
		</fieldset>
	);
}

/** Datos ampliados en modo lectura; nada si no hay ninguno. */
export function ProfileDetailsView({ details }: { details: ProfileDetails }) {
	const filled = PROFILE_DETAIL_FIELDS.filter((field) => details[field]);
	if (filled.length === 0) return null;
	const locale = getLocale();

	return (
		<section
			className="dashboard-details"
			aria-labelledby="profile-details-heading"
		>
			<h2 id="profile-details-heading" className="dashboard-details-title">
				{m.profile_details_title()}
			</h2>
			<p className="dashboard-details-note">
				<span className="material-symbols-outlined" aria-hidden="true">
					lock
				</span>
				{m.profile_details_private_note()}
			</p>
			<dl className="dashboard-details-list">
				{filled.map((field) => {
					const raw = details[field] as string;
					return (
						<div key={field}>
							<dt>{fieldLabel(field)}</dt>
							<dd>
								{field === "countryCode" ? (
									countryName(raw, locale)
								) : URL_FIELDS.has(field) ? (
									<a href={raw} rel="noopener noreferrer nofollow">
										{raw}
									</a>
								) : (
									raw
								)}
							</dd>
						</div>
					);
				})}
			</dl>
		</section>
	);
}
