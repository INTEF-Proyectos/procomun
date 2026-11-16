import {
	isResourceValidated,
	keepsValidationOnEdit,
} from "@procomun/db/validation-seal";
import "../lib/paraglide-client.ts";
import * as m from "../paraglide/messages.js";
import "./ValidatedBadge.css";

export interface ValidatedBadgeProps {
	resource: {
		editorialStatus?: string | null;
		validatedAt?: string | Date | null;
		validationSource?: string | null;
	};
	/** `detail`: en la ficha, con la explicación y la fecha. */
	variant?: "card" | "detail";
	/** Fecha ya formateada en el idioma de la página (solo en la ficha). */
	dateLabel?: string | null;
}

/**
 * Sello «Validado» (issue #420, ADR-0049): un curator o un admin revisó el
 * contenido que se ve, o venía validado del Procomún antiguo. Se identifica
 * por el texto; el icono es decorativo (WCAG 1.4.1).
 */
export function ValidatedBadge({
	resource,
	variant = "card",
	dateLabel,
}: ValidatedBadgeProps) {
	if (!isResourceValidated(resource)) return null;

	const badge = (
		<span className={`validated-badge validated-badge-${variant}`}>
			<span className="material-symbols-outlined" aria-hidden="true">
				verified
			</span>
			{m.validated_badge()}
		</span>
	);
	if (variant !== "detail") return badge;

	// Los importados no llevan fecha: la del sello sería la de la importación,
	// no la de la revisión en el Procomún antiguo.
	const showDate =
		resource.validationSource !== "legacy" &&
		!!dateLabel &&
		!!resource.validatedAt;
	const datetime =
		resource.validatedAt instanceof Date
			? resource.validatedAt.toISOString()
			: (resource.validatedAt ?? undefined);

	return (
		<span className="validated-badge-group">
			{badge}
			<span className="validated-badge-note">
				{m.validated_badge_explanation()}
				{showDate ? (
					<>
						{" · "}
						<time dateTime={datetime}>
							{m.validated_badge_on({ date: dateLabel })}
						</time>
					</>
				) : null}
			</span>
		</span>
	);
}

/**
 * Aviso en el editor (ADR-0049, punto 9): si quien edita no es curator ni
 * admin, guardar cambios quita el sello hasta que se revise de nuevo.
 */
export function ValidatedEditWarning({
	resource,
	userRole,
}: {
	resource: ValidatedBadgeProps["resource"];
	userRole: string | null | undefined;
}) {
	if (!isResourceValidated(resource) || keepsValidationOnEdit(userRole)) {
		return null;
	}
	return (
		<div className="validated-edit-warning" role="note">
			<span className="material-symbols-outlined" aria-hidden="true">
				verified
			</span>
			{m.validated_edit_warning()}
		</div>
	);
}
