import type { ElpxCardPreview, Resource } from "../../lib/api-client.ts";
import type { RatingSummary } from "./social.ts";

/** License metadata with display info */
export interface ResourceLicense {
	code: string;
	label: string;
	url: string;
	iconUrl?: string;
}

/** Compact resource representation for cards and lists */
export interface ResourceSummary {
	id: string;
	slug: string;
	title: string;
	description: string;
	resourceType: string;
	language: string | null;
	license: string;
	author?: string | null;
	/** Cuenta que publica: su nombre enlaza a su ficha (#458). */
	createdBy?: string | null;
	createdByName?: string | null;
	/** `false` si la cuenta está dada de baja: sin enlace a su ficha (#541). */
	createdByActive?: boolean | null;
	thumbnailUrl?: string | null;
	elpxPreview?: ElpxCardPreview | null;
	rating?: { average: number; count: number };
	favoriteCount?: number;
	editorialStatus: string;
	createdAt: string;
}

/** Full resource detail with social data and relations */
export interface ResourceDetail
	extends Omit<Resource, "rating" | "favoriteCount"> {
	rating: RatingSummary;
	favoriteCount: number;
	userFavorited?: boolean;
	userRating?: number | null;
	relatedResources: ResourceSummary[];
}

/** Structured resource metadata for display in metadata panels */
export interface ResourceMetadata {
	author?: string | null;
	publisher?: string | null;
	language: string | null;
	license: ResourceLicense;
	resourceType: string;
	subjects: string[];
	levels: string[];
	keywords: string[];
	duration?: number | null;
	accessibilityFeatures?: string | null;
	createdAt: string;
	updatedAt: string;
}
