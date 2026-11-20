/** Public-facing user profile */
export interface PublicUserProfile {
	id: string;
	name: string;
	avatarUrl?: string | null;
	bio?: string | null;
	role: string;
	resourceCount: number;
	favoriteCount: number;
	joinedAt: string;
}

/** Activity item for the dashboard feed */
export interface ActivityItem {
	id: string;
	type:
		| "resource_created"
		| "resource_updated"
		| "resource_published"
		| "resource_drafted"
		| "resource_status_changed"
		| "rating_given"
		| "favorite_added"
		| "favorite_removed"
		| "file_uploaded"
		| "resource_downloaded";
	resourceId?: string;
	resourceTitle?: string;
	resourceSlug?: string;
	description: string;
	metadata?: Record<string, unknown> | null;
	createdAt: string;
}

/** Summary data for the user dashboard */
export interface DashboardSummary {
	user: PublicUserProfile;
	draftCount: number;
	publishedCount: number;
	/** En revisión y archivados (#530): también cuentan en «Mis recursos». */
	reviewCount: number;
	archivedCount: number;
	/** Todos los recursos propios: la suma de los cuatro estados. */
	resourceCount: number;
	favoriteCount: number;
	recentActivity: ActivityItem[];
}
