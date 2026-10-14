import {
	categoryHasEducationalOptions,
	EDUCATIONAL_CATEGORIES,
	type EducationalAssignment,
	educationalOptionsFor,
	getEducationalCategory,
} from "@procomun/db/educational-areas";

export interface EducationalSelection {
	categoryId: string;
	optionIds: string[];
}

export interface EducationalFilterState {
	categoryId: string;
	optionId: string;
}

export interface EducationalClassificationLine {
	categoryId: string;
	categoryLabel: string;
	optionLabels: string[];
}

export function addEducationalCategory(
	selections: EducationalSelection[],
	categoryId: string,
): EducationalSelection[] {
	if (!categoryId || !getEducationalCategory(categoryId)) return selections;
	if (selections.some((selection) => selection.categoryId === categoryId)) {
		return selections;
	}
	return [...selections, { categoryId, optionIds: [] }];
}

export function removeEducationalCategory(
	selections: EducationalSelection[],
	categoryId: string,
): EducationalSelection[] {
	return selections.filter((selection) => selection.categoryId !== categoryId);
}

export function toggleEducationalOption(
	selections: EducationalSelection[],
	categoryId: string,
	optionId: string,
): EducationalSelection[] {
	const allowed = educationalOptionsFor(categoryId).some(
		(option) => option.id === optionId,
	);
	if (!allowed) return selections;
	return selections.map((selection) => {
		if (selection.categoryId !== categoryId) return selection;
		const selected = selection.optionIds.includes(optionId);
		return {
			...selection,
			optionIds: selected
				? selection.optionIds.filter((id) => id !== optionId)
				: [...selection.optionIds, optionId],
		};
	});
}

export function selectionsToAssignments(
	selections: EducationalSelection[],
): EducationalAssignment[] {
	const assignments: EducationalAssignment[] = [];
	for (const selection of selections) {
		if (selection.optionIds.length === 0) {
			assignments.push({ categoryId: selection.categoryId, optionId: null });
			continue;
		}
		for (const optionId of selection.optionIds) {
			assignments.push({ categoryId: selection.categoryId, optionId });
		}
	}
	return assignments;
}

export function assignmentsToSelections(
	areas: EducationalAssignment[] | undefined,
): EducationalSelection[] {
	const order: string[] = [];
	const optionsByCategory = new Map<string, string[]>();
	for (const area of areas ?? []) {
		if (!optionsByCategory.has(area.categoryId)) {
			optionsByCategory.set(area.categoryId, []);
			order.push(area.categoryId);
		}
		if (area.optionId) {
			optionsByCategory.get(area.categoryId)?.push(area.optionId);
		}
	}
	return order.map((categoryId) => ({
		categoryId,
		optionIds: optionsByCategory.get(categoryId) ?? [],
	}));
}

export function formatEducationalClassifications(
	areas: EducationalAssignment[] | undefined,
): EducationalClassificationLine[] {
	const optionsByCategory = new Map<string, Set<string>>();
	for (const area of areas ?? []) {
		const options = optionsByCategory.get(area.categoryId) ?? new Set();
		if (area.optionId) options.add(area.optionId);
		optionsByCategory.set(area.categoryId, options);
	}

	const lines: EducationalClassificationLine[] = [];
	for (const category of EDUCATIONAL_CATEGORIES) {
		const selected = optionsByCategory.get(category.id);
		if (!selected) continue;
		lines.push({
			categoryId: category.id,
			categoryLabel: category.label,
			optionLabels: category.options
				.filter((option) => selected.has(option.id))
				.map((option) => option.label),
		});
		optionsByCategory.delete(category.id);
	}
	return lines;
}

export function classificationLineText(
	line: EducationalClassificationLine,
): string {
	if (line.optionLabels.length === 0) return line.categoryLabel;
	return `${line.categoryLabel}: ${line.optionLabels.join(", ")}`;
}

export function sanitizeEducationalFilter(
	categoryId = "",
	optionId = "",
): EducationalFilterState {
	if (!categoryId || !getEducationalCategory(categoryId)) {
		return { categoryId: "", optionId: "" };
	}
	if (!categoryHasEducationalOptions(categoryId)) {
		return { categoryId, optionId: "" };
	}
	const valid = educationalOptionsFor(categoryId).some(
		(option) => option.id === optionId,
	);
	return { categoryId, optionId: valid ? optionId : "" };
}

export function applyEducationalFilterChange(
	current: EducationalFilterState,
	change: Partial<EducationalFilterState>,
): EducationalFilterState {
	if (
		change.categoryId !== undefined &&
		change.categoryId !== current.categoryId
	) {
		return sanitizeEducationalFilter(change.categoryId, "");
	}
	if (change.optionId !== undefined) {
		return sanitizeEducationalFilter(current.categoryId, change.optionId);
	}
	return sanitizeEducationalFilter(current.categoryId, current.optionId);
}
