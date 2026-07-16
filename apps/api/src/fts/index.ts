export {
	extractTextFromFile,
	isSupportedForExtraction,
	normalizeText,
	stripHtml,
} from "./extract.ts";
export {
	type FtsSearchOptions,
	type FtsSearchResult,
	markExtractionPending,
	markExtractionProcessing,
	reindexAllResources,
	reindexResource,
	resetUnaccentCache,
	saveExtractionResult,
	searchResources,
	updateSearchVector,
} from "./search.ts";
export {
	enqueueExtraction,
	processExtraction,
	reExtractResource,
} from "./worker.ts";
