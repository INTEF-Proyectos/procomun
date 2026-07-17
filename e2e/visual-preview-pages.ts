import { PUBLISHED_RESOURCE, SEARCH_TERMS } from "./fixtures/test-data";
import type { TestUserRole } from "./fixtures/test-users";

export interface VisualPreviewPage {
	id: string;
	title: string;
	path: string;
	readySelector: string;
	auth?: TestUserRole;
}

/**
 * Desktop views published in the pull-request visual-preview comment.
 * Add a new entry here to extend the capture set without changing CI workflows.
 */
export const VISUAL_PREVIEW_PAGES = [
	{
		id: "home",
		title: "Home",
		path: "/",
		readySelector: "main h1",
	},
	{
		id: "login",
		title: "Login",
		path: "/login",
		readySelector: "form.login-form",
	},
	{
		id: "resource-detail",
		title: "Published resource",
		path: `/recurso?slug=${encodeURIComponent(PUBLISHED_RESOURCE.slug)}`,
		readySelector: "main h1",
	},
	{
		id: "search-results",
		title: "Search results",
		path: `/explorar?q=${encodeURIComponent(SEARCH_TERMS.withResults)}`,
		readySelector: '[data-testid="resource-card"], .resource-card',
	},
	{
		id: "admin-dashboard",
		title: "Admin dashboard",
		path: "/admin",
		readySelector: "main h1",
		auth: "admin",
	},
] as const satisfies readonly VisualPreviewPage[];
