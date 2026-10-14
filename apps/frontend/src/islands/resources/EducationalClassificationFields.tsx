import {
	EDUCATIONAL_CATEGORIES,
	EDUCATIONAL_CATEGORY_LABEL,
	EDUCATIONAL_OPTION_LABEL,
	EDUCATIONAL_SECTION_TITLE,
	educationalOptionsFor,
	getEducationalCategory,
} from "@procomun/db/educational-areas";
import {
	addEducationalCategory,
	type EducationalSelection,
	removeEducationalCategory,
	toggleEducationalOption,
} from "../../lib/educational-classification.ts";

export function EducationalClassificationEditor({
	selections,
	onChange,
	idPrefix,
}: {
	selections: EducationalSelection[];
	onChange: (selections: EducationalSelection[]) => void;
	idPrefix: string;
}) {
	const used = new Set(selections.map((selection) => selection.categoryId));
	const available = EDUCATIONAL_CATEGORIES.filter(
		(category) => !used.has(category.id),
	);

	return (
		<fieldset className="educational-classification">
			<legend>{EDUCATIONAL_SECTION_TITLE}</legend>
			<p>
				Un recurso puede asociarse a varias categorías.{" "}
				{EDUCATIONAL_OPTION_LABEL} es opcional y solo aparece cuando la
				categoría lo tiene.
			</p>
			{selections.map((selection) => {
				const category = getEducationalCategory(selection.categoryId);
				const options = educationalOptionsFor(selection.categoryId);
				const label = category?.label ?? selection.categoryId;
				return (
					<div
						key={selection.categoryId}
						className="educational-classification-card"
					>
						<div>
							<strong>{label}</strong>
							<button
								type="button"
								onClick={() =>
									onChange(
										removeEducationalCategory(selections, selection.categoryId),
									)
								}
							>
								Quitar {label}
							</button>
						</div>
						{options.length > 0 ? (
							<fieldset>
								<legend>{EDUCATIONAL_OPTION_LABEL}</legend>
								{options.map((option) => {
									const inputId = `${idPrefix}-${selection.categoryId}-${option.id}`;
									return (
										<label key={option.id} htmlFor={inputId}>
											<input
												id={inputId}
												type="checkbox"
												checked={selection.optionIds.includes(option.id)}
												onChange={() =>
													onChange(
														toggleEducationalOption(
															selections,
															selection.categoryId,
															option.id,
														),
													)
												}
											/>
											{option.label}
										</label>
									);
								})}
							</fieldset>
						) : null}
					</div>
				);
			})}
			{available.length > 0 ? (
				<label htmlFor={`${idPrefix}-add-category`}>
					{EDUCATIONAL_CATEGORY_LABEL}
					<select
						id={`${idPrefix}-add-category`}
						value=""
						onChange={(event) => {
							const categoryId = event.currentTarget.value;
							if (!categoryId) return;
							onChange(addEducationalCategory(selections, categoryId));
						}}
					>
						<option value="">Seleccionar…</option>
						{available.map((category) => (
							<option key={category.id} value={category.id}>
								{category.label}
							</option>
						))}
					</select>
				</label>
			) : null}
		</fieldset>
	);
}
