/*
 * Fachada genérica de embeds para contenido .elpx (ADR-0048, convivencia con el
 * artefacto de eXeLearning; viene del shim de ADR-0027).
 *
 * Se inyecta en el HTML del .elpx servido por la API, DESPUÉS del artefacto
 * vendorizado (`/api/v1/elpx/embed-shim.js`), y se ejecuta dentro del iframe de
 * origen opaco (ADR-0026). El sandbox se hereda, así que Canva, Padlet, Genially,
 * MuseScore… no cargan dentro. El artefacto solo trata sus proveedores de vídeo
 * y el relay los PDF; este script cambia el resto de <iframe> https externos por
 * un enlace «Ver contenido de <host>» que abre el contenido en una pestaña nueva,
 * fuera del sandbox.
 *
 * Para no pisar al artefacto, ignora los PDF y los hosts de ARTIFACT_HOSTS, que
 * deben coincidir con el registro del artefacto (lo comprueba un test de
 * elpx-content). Sobra cuando el artefacto incluya una fachada genérica o cuando
 * el contenido se sirva desde un dominio propio (#429).
 */
(() => {
	// Activar SOLO en origen opaco (modo seguro). En same-origin no hace nada.
	function isOpaqueOrigin() {
		try {
			if (window.origin === "null" || window.origin === null) return true;
		} catch {
			return true;
		}
		try {
			// document.cookie lanza en documentos sandbox de origen opaco.
			void document.cookie;
		} catch {
			return true;
		}
		return false;
	}

	if (!isOpaqueOrigin()) return;

	// Proveedores del registro del artefacto de eXe (exe-external-media-child).
	var ARTIFACT_HOSTS = [
		"youtube.com",
		"youtu.be",
		"youtube-nocookie.com",
		"vimeo.com",
		"dailymotion.com",
		"dai.ly",
		"mediateca.educa.madrid.org",
	];

	function hostMatches(hostname, domain) {
		return hostname === domain || hostname.endsWith(`.${domain}`);
	}

	// Solo <iframe> https de otro host, que no sea PDF ni de un proveedor del
	// artefacto. Los del propio paquete se quedan como están.
	function isFacadeCandidate(src) {
		try {
			const u = new URL(src, window.location.href);
			const hostname = u.hostname.toLowerCase().replace(/\.$/, "");
			if (u.protocol !== "https:") return false;
			if (hostname === window.location.hostname.toLowerCase()) return false;
			if (/\.pdf$/i.test(u.pathname)) return false;
			return !ARTIFACT_HOSTS.some((domain) => hostMatches(hostname, domain));
		} catch {
			return false;
		}
	}

	function cssSize(attr, fallback) {
		if (!attr) return fallback;
		return /^[0-9]+$/.test(attr) ? `${attr}px` : attr;
	}

	function makeFacade(frame, src) {
		var doc = frame.ownerDocument;
		var url = new URL(src, window.location.href).href;
		var link = doc.createElement("a");
		link.href = url;
		link.target = "_blank";
		link.rel = "noopener";
		link.className = "procomun-embed-facade";
		link.setAttribute("data-procomun-embed-url", url);
		link.style.cssText =
			"display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:1em;" +
			"text-align:center;text-decoration:underline;background:#000;color:#fff;" +
			"font:600 14px/1.3 system-ui,sans-serif;max-width:100%;" +
			"width:" +
			cssSize(frame.getAttribute("width"), "100%") +
			";height:min(" +
			cssSize(frame.getAttribute("height"), "240px") +
			",60vh);";
		// Embed adaptable (Canva): el <iframe> va posicionado sobre un contenedor
		// de alto 0; en el flujo, la fachada caería fuera del hueco (#427).
		// Un hueco del artefacto no conserva el position del <iframe>: se reconoce
		// por su contenedor de alto 0.
		var positioned = /^(absolute|fixed)$/.test(getComputedStyle(frame).position);
		var parent = frame.parentElement;
		if (!positioned && frame.tagName !== "IFRAME" && parent) {
			positioned = getComputedStyle(parent).height === "0px";
		}
		if (positioned) {
			link.style.cssText +=
				"position:absolute;top:0;left:0;width:100%;height:100%;";
		}
		link.textContent = `Ver contenido de ${new URL(url).hostname.replace(/^www\./, "")}`;
		return link;
	}

	// Orden de carga: este script va detrás del artefacto, pero corre al cargar
	// el DOM, y el artefacto solo cambia <iframe> tras el saludo con la ficha.
	// Así que normalmente la fachada llega antes. Si el artefacto se adelanta,
	// deja un hueco negro ([data-exe-embed-url]) también para hosts que no sabe
	// reproducir; esos huecos se cambian igual por la fachada.
	function promote(root) {
		var nodes = root.querySelectorAll(
			"iframe[src], [data-exe-embed-url]:not([data-exe-embed-provider])",
		);
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const src =
				node.tagName === "IFRAME"
					? node.getAttribute("src")
					: node.getAttribute("data-exe-embed-url");
			if (!src || !isFacadeCandidate(src)) continue;
			if (node.parentNode) {
				node.parentNode.replaceChild(makeFacade(node, src), node);
			}
		}
	}

	function run() {
		try {
			promote(document);
		} catch {
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
		const observer = new MutationObserver(() => {
			run();
		});
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	} catch {
		/* MutationObserver no disponible: el escaneo inicial es suficiente */
	}
})();
