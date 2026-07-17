/**
 * Sandbox token set for the opaque-origin eXeLearning content iframe (preview/editor).
 *
 * Single source of truth, mirroring the canonical secure set used by mod_exelearning,
 * wp-exelearning and omeka-s-exelearning. It deliberately OMITS:
 *   - `allow-same-origin` — so the author content runs in an opaque origin and cannot
 *     reach the authenticated platform (DOM, cookies, /api/v1), and
 *   - `allow-popups-to-escape-sandbox` — so a popup the content opens STAYS sandboxed;
 *     otherwise an author-controlled same-origin document (e.g. an uploaded SVG) opened
 *     in a popup would run script at the platform origin. See security audit finding H-1.
 *
 * `allow-forms` is kept so the form-based eXeLearning iDevices can submit inside the
 * sandbox; it is orthogonal to `allow-same-origin` and does not weaken isolation.
 */
export const CONTENT_IFRAME_SANDBOX = "allow-scripts allow-popups allow-forms";

/**
 * Public "embed on your site" iframe snippet. Reuses the same sandbox token set as the
 * in-platform preview so third-party hosts that paste the snippet get opaque isolation
 * by default (no same-origin escape, no popup-to-escape).
 */
export function buildPublicEmbedIframeCode(title: string, src: string): string {
	const safeTitle = title.replace(/"/g, "&quot;");
	return `<iframe title="${safeTitle}" src="${src}" width="1100" height="540" frameborder="0" allowfullscreen sandbox="${CONTENT_IFRAME_SANDBOX}" referrerpolicy="no-referrer"></iframe>`;
}
