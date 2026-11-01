import type { EducationalAssignment } from "@procomun/db/educational-areas";
import { EDUCATIONAL_SECTION_TITLE } from "@procomun/db/educational-areas";
import { formatEducationalClassifications } from "../../lib/educational-classification.ts";
import { searchHref } from "../../lib/resource-display.ts";

/** Valor de la ficha que lanza una búsqueda de texto con él (#459). */
export function SearchValue({ value }: { value: string }) {
	return (
		<a className="meta-value-link" href={searchHref(value)}>
			{value}
		</a>
	);
}

/** Varios valores separados por comas, cada uno con su propia búsqueda. */
export function SearchValueList({ values }: { values: string[] }) {
	return values.map((value, index) => (
		<span key={value}>
			{index > 0 ? ", " : null}
			<SearchValue value={value} />
		</span>
	));
}

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
					<li key={line.categoryId}>
						<SearchValue value={line.categoryLabel} />
						{line.optionLabels.length > 0 ? (
							<>
								{": "}
								<SearchValueList values={line.optionLabels} />
							</>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}
