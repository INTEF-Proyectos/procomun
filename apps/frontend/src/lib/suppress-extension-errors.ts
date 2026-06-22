/**
 * Suppresses known browser-extension errors that surface as unhandled promise
 * rejections during normal navigation.
 *
 * The error "A listener indicated an asynchronous response by returning true,
 * but the message channel closed before a response was received" originates
 * from Chrome extension messaging (chrome.runtime.onMessage) — not from our
 * application code — but still pollutes the console as an uncaught promise
 * rejection.
 *
 * This module installs a global `unhandledrejection` handler that prevents
 * those specific errors from propagating.
 */

const EXTENSION_ERROR_PATTERNS: RegExp[] = [
	/message channel closed before a response was received/i,
	/the message port closed before a response was received/i,
];

function isExtensionError(reason: unknown): boolean {
	const message =
		reason instanceof Error
			? reason.message
			: typeof reason === "string"
				? reason
				: "";
	return EXTENSION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function installExtensionErrorSuppressor(): () => void {
	function handler(event: PromiseRejectionEvent) {
		if (isExtensionError(event.reason)) {
			event.preventDefault();
		}
	}
	window.addEventListener("unhandledrejection", handler);
	return () => window.removeEventListener("unhandledrejection", handler);
}

export { isExtensionError };
