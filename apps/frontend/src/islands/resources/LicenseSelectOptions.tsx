import { m } from "../../paraglide/messages.js";
import { LICENSE_OPTIONS } from "./resource-form-options.ts";

export function LicenseSelectOptions() {
	const localized = {
		"cc-by-nd": m.license_no_derivatives(),
		"cc-by-nc-nd": m.license_noncommercial_no_derivatives(),
		cc0: m.license_public_domain(),
	};
	return LICENSE_OPTIONS.map(({ value, label }) => (
		<option key={value} value={value}>
			{value in localized ? localized[value as keyof typeof localized] : label}
		</option>
	));
}
