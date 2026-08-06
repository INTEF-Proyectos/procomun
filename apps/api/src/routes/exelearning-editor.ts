/**
 * Serves the eXeLearning static editor with Procomun bootstrap config injected.
 * Equivalent to editor-bootstrap.php in wp-exelearning.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";

const EDITOR_STATIC_DIR = path.resolve(
	import.meta.dir,
	"../../static/exelearning-editor/static",
);

/**
 * Serializes a value as JSON that is safe to embed inside an inline <script>.
 *
 * `JSON.stringify` alone does NOT escape the literal sequence `</script>`
 * (nor `<`, `>`, the line separators U+2028/U+2029), so reflecting
 * user-controlled values straight into an inline script lets an attacker break
 * out of the <script> element and inject arbitrary markup (reflected XSS).
 * We escape `<`, `>`, `&`, U+2028 and U+2029 to unicode escape sequences, which
 * keeps the value JSON-parseable while preventing script breakout.
 */
export function toInlineScriptJson(value: unknown): string {
	return JSON.stringify(value ?? null)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/**
 * Builds the Procomun embedding config <script> block injected into the editor.
 *
 * Pure function so it can be unit-tested without the static editor file.
 * User-controlled values (`elpxUrl`, `resourceId`) are encoded with
 * {@link toInlineScriptJson} to prevent reflected XSS.
 */
export function buildEditorConfigScript(
	elpxUrl: string,
	resourceId: string,
	editorBaseUrl: string,
): string {
	return `
<script>
window.__EXE_EMBEDDING_CONFIG__ = {
	basePath: ${toInlineScriptJson(editorBaseUrl)},
	initialProjectUrl: ${toInlineScriptJson(elpxUrl || null)},
	parentOrigin: window.location.origin,
	trustedOrigins: [window.location.origin],
	previewSnapshot: {
		managementUrl: "/api/v1/preview-session",
		servingBaseUrl: "/api/v1/preview",
		deleteUrlTemplate: "/api/v1/preview-session/{previewId}",
	},
	hideUI: {
		fileMenu: true,
		saveButton: true,
		userMenu: true,
	},
};
window.__PROCOMUN_CONFIG__ = {
	resourceId: ${toInlineScriptJson(resourceId)},
	editorBaseUrl: ${toInlineScriptJson(editorBaseUrl)},
};
</script>`;
}

export const exelearningEditorRoutes = new Hono();

/**
 * Bootstrap page: loads editor index.html with Procomun embedding config injected.
 * Query params: elpxUrl (URL to load), resourceId
 */
exelearningEditorRoutes.get("/index.html", async (c) => {
	const elpxUrl = c.req.query("elpxUrl") || "";
	const resourceId = c.req.query("resourceId") || "";

	const indexPath = path.join(EDITOR_STATIC_DIR, "index.html");
	let html: string;
	try {
		html = await readFile(indexPath, "utf-8");
	} catch {
		return c.text(
			"Editor no disponible. Ejecuta: make download-exelearning-editor",
			404,
		);
	}

	// Determine editor base URL for asset resolution
	const editorBaseUrl = "/api/v1/exelearning-editor";

	// Inject <base> for relative asset resolution, then the Service Worker
	// neutralizing stub — it MUST run before any editor script so a same-origin
	// preview SW can never register on the Procomun origin.
	html = html.replace(
		"<head>",
		`<head>\n<base href="${editorBaseUrl}/">\n${SW_NEUTRALIZE_SCRIPT}`,
	);

	// Inject Procomun embedding config before </head>. User-controlled query
	// values are encoded as script-safe JSON to prevent `</script>` breakout.
	const configScript = buildEditorConfigScript(
		elpxUrl,
		resourceId,
		editorBaseUrl,
	);
	html = html.replace("</head>", `${configScript}\n</head>`);

	// Inject the bridge script before </body> — handles postMessage communication
	// with the parent (same role as wp-exe-bridge.js in wp-exelearning)
	html = html.replace("</body>", `${BRIDGE_SCRIPT}\n</body>`);

	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-cache",
			// Evita que el navegador reinterprete el bootstrap como otro MIME.
			"X-Content-Type-Options": "nosniff",
			// Defense-in-depth: el escape de buildEditorConfigScript es el fix
			// principal de XSS; esta CSP limita plugins y el ancestro del frame.
			"Content-Security-Policy":
				"object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
		},
	});
});

/**
 * Interim Service Worker neutralizing stub.
 *
 * The bundled pre-v2 editor (v4.0.1) still ships `loadPreviewFromServiceWorker()`
 * and can call `navigator.serviceWorker.register('/preview-sw.js')` to drive a
 * SAME-ORIGIN Service Worker preview. On the Procomun origin that would run
 * untrusted author content same-origin — exactly what the opaque HTTP preview
 * exists to prevent. Until an editor build with the opaque preview ships and
 * this stub becomes unnecessary, neutralize SW registration so no preview SW can
 * be installed on this origin; the supported transport is the injected
 * `previewSnapshot` config.
 *
 * The dummy returned from `register()` is a full ServiceWorkerRegistration-like
 * object (not a bare `{}`) because the v4 editor calls `reg.addEventListener`
 * and would otherwise throw and abort its hidden export iframe.
 */
const SW_NEUTRALIZE_SCRIPT = `<script>
(function () {
	'use strict';
	if (!('serviceWorker' in navigator)) return;
	var dummy = {
		scope: '', installing: null, waiting: null, active: null,
		addEventListener: function () {}, removeEventListener: function () {},
		update: function () { return Promise.resolve(); },
		unregister: function () { return Promise.resolve(true); }
	};
	try {
		navigator.serviceWorker.register = function () { return Promise.resolve(dummy); };
		navigator.serviceWorker.getRegistration = function () { return Promise.resolve(undefined); };
		navigator.serviceWorker.getRegistrations = function () { return Promise.resolve([]); };
	} catch (e) { void e; }
})();
</script>`;

/**
 * Bridge script injected into the editor iframe.
 * Ported from wp-exelearning/assets/js/wp-exe-bridge.js.
 * Handles: EXELEARNING_READY, WP_REQUEST_SAVE → WP_SAVE_FILE, CONFIGURE, DOCUMENT_LOADED/CHANGED.
 */
const BRIDGE_SCRIPT = `<script>
(function() {
	'use strict';
	var targetOrigin = window.__EXE_EMBEDDING_CONFIG__?.parentOrigin || '*';
	var documentLoadedNotified = false;

	function post(msg) {
		if (window.parent && window.parent !== window) window.parent.postMessage(msg, targetOrigin);
	}

	async function getApp(timeout) {
		timeout = timeout || 15000;
		var start = Date.now();
		while (Date.now() - start < timeout) {
			if (window.eXeLearning?.app) return window.eXeLearning.app;
			await new Promise(function(r) { setTimeout(r, 100); });
		}
		throw new Error('App not ready');
	}

	async function exportToBytes() {
		var app = await getApp();
		var project = app.project;
		var blob, filename = 'project.elpx';
		if (window.SharedExporters?.createExporter && project?._yjsBridge?.documentManager) {
			var yb = project._yjsBridge;
			var exporter = window.SharedExporters.createExporter('elpx', yb.documentManager, yb.assetCache || null, yb.resourceFetcher || null, yb.assetManager || null);
			var result = await exporter.export({});
			if (!result?.success || !result?.data) throw new Error(result?.error || 'Export failed');
			blob = new Blob([result.data], { type: 'application/zip' });
			filename = result.filename || filename;
		} else if (project && typeof project.exportToElpxBlob === 'function') {
			blob = await project.exportToElpxBlob();
			filename = project.getExportFilename?.() || filename;
		} else if (project?._yjsBridge?.exporter) {
			blob = await project._yjsBridge.exporter.exportToBlob();
			filename = project._yjsBridge.exporter.buildFilename?.() || filename;
		} else {
			throw new Error('Export not available');
		}
		var bytes = await blob.arrayBuffer();
		return { bytes: bytes, filename: filename, mimeType: blob.type || 'application/zip' };
	}

	function applyHideUI(h) {
		if (!h) return;
		var b = document.body;
		if (h.fileMenu) b.setAttribute('data-exe-hide-file-menu', 'true');
		if (h.saveButton) b.setAttribute('data-exe-hide-save', 'true');
		if (h.userMenu) b.setAttribute('data-exe-hide-user-menu', 'true');
	}

	async function notifyDocumentLoaded() {
		var start = Date.now();
		while (Date.now() - start < 30000) {
			var mgr = window.eXeLearning?.app?.project?._yjsBridge?.documentManager;
			if (mgr && !documentLoadedNotified) {
				documentLoadedNotified = true;
				post({ type: 'DOCUMENT_LOADED' });
				// Monitor changes
				var ydoc = mgr.ydoc;
				if (ydoc && typeof ydoc.on === 'function') {
					var changed = false;
					ydoc.on('update', function() {
						if (!changed) { changed = true; post({ type: 'DOCUMENT_CHANGED' }); }
					});
				}
				return;
			}
			await new Promise(function(r) { setTimeout(r, 150); });
		}
	}

	async function exportToFormat(format) {
		var app = await getApp();
		var project = app.project;
		if (!window.SharedExporters?.quickExport) throw new Error('SharedExporters not available');
		if (!project?._yjsBridge?.documentManager) throw new Error('Document manager not available');
		var yb = project._yjsBridge;
		var result = await window.SharedExporters.quickExport(
			format,
			yb.documentManager,
			yb.assetCache || null,
			yb.resourceFetcher || null,
			{},
			yb.assetManager || null
		);
		if (!result?.success || !result?.data) throw new Error(result?.error || 'Export failed');
		var blob = new Blob([result.data], { type: 'application/zip' });
		var bytes = await blob.arrayBuffer();
		return { bytes: bytes, filename: result.filename || ('export.' + format + '.zip'), mimeType: blob.type || 'application/zip' };
	}

	async function handleMessage(event) {
		var msg = event?.data;
		if (!msg?.type || msg.source === 'procomun-bridge') return;
		try {
			switch (msg.type) {
				case 'WP_REQUEST_SAVE':
					var exported = await exportToBytes();
					post({ type: 'WP_SAVE_FILE', requestId: msg.requestId, bytes: exported.bytes, filename: exported.filename, mimeType: exported.mimeType, size: exported.bytes.byteLength });
					break;
				case 'WP_REQUEST_EXPORT':
					var format = msg.format || 'html5';
					var validFormats = ['scorm12', 'scorm2004', 'ims', 'html5', 'html5-sp', 'epub3'];
					if (validFormats.indexOf(format) === -1) throw new Error('Formato no soportado: ' + format);
					var expResult = await exportToFormat(format);
					post({ type: 'WP_EXPORT_FILE', requestId: msg.requestId, bytes: expResult.bytes, filename: expResult.filename, mimeType: expResult.mimeType, size: expResult.bytes.byteLength });
					break;
				case 'CONFIGURE':
					applyHideUI(msg.data?.hideUI);
					post({ type: 'CONFIGURE_SUCCESS', requestId: msg.requestId });
					break;
				case 'WP_SAVE_CONFIRMED':
					var mgr2 = window.eXeLearning?.app?.project?._yjsBridge?.documentManager;
					if (mgr2?.markClean) mgr2.markClean();
					window.onbeforeunload = null;
					post({ type: 'WP_SAVE_CONFIRMED_ACK', requestId: msg.requestId });
					break;
			}
		} catch (err) {
			post({ type: (msg.type || 'UNKNOWN') + '_ERROR', requestId: msg.requestId, error: err?.message || 'Unknown error' });
		}
	}

	async function init() {
		if (window.eXeLearning?.ready) await window.eXeLearning.ready;
		window.addEventListener('message', handleMessage);
		post({ type: 'EXELEARNING_READY', version: window.eXeLearning?.version || 'unknown', capabilities: ['WP_REQUEST_SAVE', 'WP_REQUEST_EXPORT', 'CONFIGURE'] });
		notifyDocumentLoaded();
		document.addEventListener('keydown', function(e) {
			if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); post({ type: 'DOCUMENT_CHANGED' }); }
		});
	}

	init();
})();
</script>`;

/**
 * Serve all static editor assets (JS, CSS, images, fonts, etc.)
 */
exelearningEditorRoutes.get("/*", async (c) => {
	const urlPath = new URL(c.req.url).pathname;
	// Strip the route prefix to get the relative file path
	const prefix = "/api/v1/exelearning-editor/";
	const relativePath = urlPath.startsWith(prefix)
		? urlPath.slice(prefix.length)
		: urlPath.replace(/^\/+/, "");

	if (!relativePath || relativePath.includes("..")) {
		return c.text("Not found", 404);
	}

	// Defense in depth (see ADR-0032 and the SW_NEUTRALIZE_SCRIPT above): never
	// serve the legacy preview Service Worker from this origin. The bundled pre-v2
	// editor could otherwise register `preview-sw.js` and run untrusted author
	// content SAME-ORIGIN as the authenticated user. The register() stub blocks
	// installation; refusing to serve the script blocks it a second way. Both go
	// away once an HTTP-preview-v2 editor is bundled.
	if (path.basename(relativePath) === "preview-sw.js") {
		return c.text("Not found", 404);
	}

	const filePath = path.join(EDITOR_STATIC_DIR, relativePath);
	const file = Bun.file(filePath);

	if (!(await file.exists())) {
		return c.text("Not found", 404);
	}

	// Determine MIME type from extension
	const ext = path.extname(relativePath).slice(1).toLowerCase();
	const mimeTypes: Record<string, string> = {
		html: "text/html",
		js: "application/javascript",
		mjs: "application/javascript",
		css: "text/css",
		json: "application/json",
		xml: "application/xml",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		ico: "image/x-icon",
		woff: "font/woff",
		woff2: "font/woff2",
		ttf: "font/ttf",
		otf: "font/otf",
		mp3: "audio/mpeg",
		mp4: "video/mp4",
		webm: "video/webm",
		wav: "audio/wav",
		pdf: "application/pdf",
		zip: "application/zip",
		txt: "text/plain",
	};
	const contentType = mimeTypes[ext] || "application/octet-stream";

	return new Response(file, {
		headers: {
			"Content-Type": contentType,
			"Cache-Control": "public, max-age=3600",
		},
	});
});
