export { extractTextFromFile, isSupportedForExtraction, normalizeText, stripHtml } from "./extract.ts";
export {
	searchResources,
	updateSearchVector,
	reindexResource,
	reindexAllResources,
	saveExtractionResult,
	markExtractionPending,
	markExtractionProcessing,
	type FtsSearchOptions,
	type FtsSearchResult,
} from "./search.ts";
export { enqueueExtraction, processExtraction, reExtractResource } from "./worker.ts";
