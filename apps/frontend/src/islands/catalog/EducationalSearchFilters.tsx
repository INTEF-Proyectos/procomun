import {
	EDUCATIONAL_CATEGORIES,
	EDUCATIONAL_CATEGORY_LABEL,
	EDUCATIONAL_OPTION_LABEL,
	educationalOptionsFor,
} from "@procomun/db/educational-areas";
import {
	applyEducationalFilterChange,
	type EducationalFilterState,
} from "../../lib/educational-classification.ts";

export function EducationalSearchFilters({
	categoryId,
	optionId,
	onChange,
}: {
	categoryId: string;
	optionId: string;
	onChange: (next: EducationalFilterState) => void;
}) {
	const options = educationalOptionsFor(categoryId);
	const current = { categoryId, optionId };

	return (
		<>
			<div className="filter-group">
				<label htmlFor="filter-educational-category">
					{EDUCATIONAL_CATEGORY_LABEL}
				</label>
				<select
					id="filter-educational-category"
					value={categoryId}
					onChange={(event) => {
						onChange(
							applyEducationalFilterChange(current, {
								categoryId: event.currentTarget.value,
							}),
						);
					}}
				>
					<option value="">Todas</option>
					{EDUCATIONAL_CATEGORIES.map((category) => (
						<option key={category.id} value={category.id}>
							{category.label}
						</option>
					))}
				</select>
			</div>
			{options.length > 0 ? (
				<div className="filter-group">
					<label htmlFor="filter-educational-option">
						{EDUCATIONAL_OPTION_LABEL}
					</label>
					<select
						id="filter-educational-option"
						value={optionId}
						onChange={(event) => {
							onChange(
								applyEducationalFilterChange(current, {
									optionId: event.currentTarget.value,
								}),
							);
						}}
					>
						<option value="">Cualquier ciclo, tramo, nivel o ámbito</option>
						{options.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			) : null}
		</>
	);
}
