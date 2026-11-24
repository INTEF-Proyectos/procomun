import {
	EDUCATIONAL_CATEGORIES,
	EDUCATIONAL_CATEGORY_LABEL,
	EDUCATIONAL_OPTION_LABEL,
	EDUCATIONAL_SECTION_TITLE,
	educationalOptionsFor,
	getEducationalCategory,
} from "@procomun/db/educational-areas";
import { useEffect, useRef, useState } from "react";
import {
	addEducationalCategory,
	type EducationalSelection,
	removeEducationalCategory,
	toggleEducationalOption,
} from "../../lib/educational-classification.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import "./EducationalClassificationFields.css";

export function EducationalClassificationEditor({
	selections,
	onChange,
	idPrefix,
	subject = "Un recurso",
}: {
	selections: EducationalSelection[];
	onChange: (selections: EducationalSelection[]) => void;
	idPrefix: string;
	/** Lo que se clasifica, para la frase de ayuda («Una colección»). */
	subject?: string;
}) {
	const addSelectRef = useRef<HTMLSelectElement>(null);
	const [focusAddSelect, setFocusAddSelect] = useState(false);
	const used = new Set(selections.map((selection) => selection.categoryId));
	const available = EDUCATIONAL_CATEGORIES.filter(
		(category) => !used.has(category.id),
	);

	// Tras «Quitar», el botón desaparece: el foco pasa al selector de categoría,
	// que siempre existe porque la categoría quitada vuelve a estar disponible.
	useEffect(() => {
		if (!focusAddSelect) return;
		addSelectRef.current?.focus();
		setFocusAddSelect(false);
	}, [focusAddSelect]);

	return (
		<fieldset className="educational-classification">
			<legend>{EDUCATIONAL_SECTION_TITLE}</legend>
			<p className="educational-classification-help">
				{subject} puede asociarse a varias categorías.{" "}
				{EDUCATIONAL_OPTION_LABEL} es opcional y solo aparece cuando la
				categoría lo tiene.
			</p>
			{selections.map((selection) => {
				const category = getEducationalCategory(selection.categoryId);
				const options = educationalOptionsFor(selection.categoryId);
				const label = category?.label ?? selection.categoryId;
				return (
					<fieldset
						key={selection.categoryId}
						className="educational-classification-group"
					>
						<legend>{label}</legend>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								onChange(
									removeEducationalCategory(selections, selection.categoryId),
								);
								setFocusAddSelect(true);
							}}
						>
							Quitar {label}
						</Button>
						{options.length > 0 ? (
							<div className="educational-classification-options">
								{options.map((option) => (
									<Checkbox
										key={option.id}
										id={`${idPrefix}-${selection.categoryId}-${option.id}`}
										label={option.label}
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
								))}
							</div>
						) : null}
					</fieldset>
				);
			})}
			{available.length > 0 ? (
				<div className="educational-classification-add">
					<label htmlFor={`${idPrefix}-add-category`}>
						{EDUCATIONAL_CATEGORY_LABEL}
					</label>
					<select
						ref={addSelectRef}
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
				</div>
			) : null}
		</fieldset>
	);
}
