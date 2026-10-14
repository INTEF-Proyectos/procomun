export type HistoryUpdateMode = "push" | "replace";

export interface ListingState {
	query: string;
	page: number;
	resourceType: string;
	language: string;
	license: string;
	/** Atomized tag slug filter (issue #310). */
	tag: string;
	/** Categoría educativa principal (issue #380). */
	educationalCategory?: string;
	/** Opción secundaria de esa categoría. Vacía si no se concreta. */
	educationalOption?: string;
}

interface HistoryLike {
	pushState(data: unknown, unused: string, url?: string | URL | null): void;
	replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function readListingState(search: string): ListingState {
	const params = new URLSearchParams(search);

	return {
		query: params.get("q") ?? "",
		page: Math.max(1, Number(params.get("page") ?? "1") || 1),
		resourceType: params.get("resourceType") ?? "",
		language: params.get("language") ?? "",
		license: params.get("license") ?? "",
		tag: params.get("tag") ?? "",
		educationalCategory: params.get("educationalCategory") ?? "",
		educationalOption: params.get("educationalOption") ?? "",
	};
}

export function buildListingUrl(
	pathname: string,
	search: string,
	state: ListingState,
): string {
	const params = new URLSearchParams(search);
	if (state.query) {
		params.set("q", state.query);
	} else {
		params.delete("q");
	}

	if (state.page > 1) {
		params.set("page", String(state.page));
	} else {
		params.delete("page");
	}

	if (state.resourceType) {
		params.set("resourceType", state.resourceType);
	} else {
		params.delete("resourceType");
	}

	if (state.language) {
		params.set("language", state.language);
	} else {
		params.delete("language");
	}

	if (state.license) {
		params.set("license", state.license);
	} else {
		params.delete("license");
	}

	if (state.tag) {
		params.set("tag", state.tag);
	} else {
		params.delete("tag");
	}

	if (state.educationalCategory) {
		params.set("educationalCategory", state.educationalCategory);
	} else {
		params.delete("educationalCategory");
	}

	if (state.educationalOption) {
		params.set("educationalOption", state.educationalOption);
	} else {
		params.delete("educationalOption");
	}

	const queryString = params.toString();
	return queryString ? `${pathname}?${queryString}` : pathname;
}

export function writeListingStateToHistory(
	history: HistoryLike,
	targetUrl: string,
	mode: HistoryUpdateMode,
): void {
	if (mode === "push") {
		history.pushState({}, "", targetUrl);
		return;
	}

	history.replaceState({}, "", targetUrl);
}
