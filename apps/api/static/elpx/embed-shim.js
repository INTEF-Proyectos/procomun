/*
 * Shim de promoción de embeds para contenido .elpx (ADR-0027).
 *
 * Se inyecta en el HTML del .elpx servido por la API y se ejecuta DENTRO del
 * iframe de origen opaco (sandbox sin allow-same-origin, ADR-0026). Como el
 * sandbox se hereda, los embeds anidados de YouTube/Vimeo/PDF se rompen. Este
 * shim los sustituye por una fachada clicable y, al pulsar, pide al frame
 * principal (Procomún) que abra el contenido en un player de confianza.
 *
 * Detección "coarse" a propósito: la validación autoritativa la hace el padre
 * (apps/frontend/src/lib/elpx-embed-policy.ts). Aquí no se confía en nada.
 */
(function () {
	"use strict";

	// Activar SOLO en origen opaco (modo seguro). En same-origin no hace nada.
	function isOpaqueOrigin() {
		try {
			if (window.origin === "null" || window.origin === null) return true;
		} catch (e) {
			return true;
		}
		try {
			// document.cookie lanza en documentos sandbox de origen opaco.
			void document.cookie;
		} catch (e) {
			return true;
		}
		return false;
	}

	if (!isOpaqueOrigin()) return;

	var PARENT = window.parent;
	if (!PARENT || PARENT === window) return;

	function isCrossOriginHttps(src) {
		try {
			var u = new URL(src, window.location.href);
			return (
				u.protocol === "https:" &&
				u.hostname.toLowerCase() !== window.location.hostname.toLowerCase()
			);
		} catch (e) {
			return false;
		}
	}

	function isPdf(src) {
		try {
			return /\.pdf$/i.test(new URL(src, window.location.href).pathname);
		} catch (e) {
			return false;
		}
	}

	function isPromotable(src) {
		return isCrossOriginHttps(src) || isPdf(src);
	}

	function absolute(src) {
		try {
			return new URL(src, window.location.href).href;
		} catch (e) {
			return src;
		}
	}

	function cssSize(attr, fallback) {
		if (!attr) return fallback;
		return /^[0-9]+$/.test(attr) ? attr + "px" : attr;
	}

	function makeFacade(frame) {
		var doc = frame.ownerDocument;
		var url = absolute(frame.getAttribute("src"));
		var btn = doc.createElement("button");
		btn.type = "button";
		btn.className = "procomun-embed-facade";
		btn.setAttribute("data-procomun-embed-url", url);
		btn.setAttribute("aria-label", "Reproducir contenido externo");
		btn.style.cssText =
			"display:flex;align-items:center;justify-content:center;border:0;cursor:pointer;" +
			"background:#000;color:#fff;font:600 14px/1.3 system-ui,sans-serif;max-width:100%;" +
			"width:" +
			cssSize(frame.getAttribute("width"), "100%") +
			";height:" +
			cssSize(frame.getAttribute("height"), "240px") +
			";";
		var span = doc.createElement("span");
		span.style.pointerEvents = "none";
		span.textContent = "▶ Ver contenido externo";
		btn.appendChild(span);
		btn.addEventListener("click", function () {
			PARENT.postMessage(
				{ source: "procomun-elpx-embed", action: "play", url: url },
				"*",
			);
		});
		return btn;
	}

	function promote(root) {
		var frames = root.querySelectorAll("iframe[src]");
		for (var i = 0; i < frames.length; i++) {
			var frame = frames[i];
			if (frame.getAttribute("data-procomun-embed")) continue;
			var src = frame.getAttribute("src");
			if (!src || !isPromotable(src)) continue;
			frame.setAttribute("data-procomun-embed", "1");
			var facade = makeFacade(frame);
			if (frame.parentNode) frame.parentNode.replaceChild(facade, frame);
		}
	}

	function run() {
		try {
			promote(document);
		} catch (e) {
			/* noop */
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", run);
	} else {
		run();
	}

	// Re-escanear ante cambios del DOM (navegación entre páginas del paquete).
	try {
		var observer = new MutationObserver(function () {
			run();
		});
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	} catch (e) {
		/* MutationObserver no disponible: el escaneo inicial es suficiente */
	}
})();
