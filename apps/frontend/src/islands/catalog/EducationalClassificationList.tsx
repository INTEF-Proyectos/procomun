import type { EducationalAssignment } from "@procomun/db/educational-areas";
import { EDUCATIONAL_SECTION_TITLE } from "@procomun/db/educational-areas";
import {
	classificationLineText,
	formatEducationalClassifications,
} from "../../lib/educational-classification.ts";

export function EducationalClassificationList({
	areas,
}: {
	areas?: EducationalAssignment[];
}) {
	const lines = formatEducationalClassifications(areas);
	if (lines.length === 0) return null;

	return (
		<div className="meta-section">
			<h3 className="meta-section-title">{EDUCATIONAL_SECTION_TITLE}</h3>
			<ul>
				{lines.map((line) => (
					<li key={line.categoryId}>{classificationLineText(line)}</li>
				))}
			</ul>
		</div>
	);
}
