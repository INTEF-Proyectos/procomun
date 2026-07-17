import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import "./styles/design-tokens.css";
import "./styles/reset.css";
import "./styles/utilities.css";
// Initialize Paraglide locale detection (reads <html lang> set by index.html)
import "./lib/i18n.ts";
// Suppress known browser-extension errors (DEF-001)
import { installExtensionErrorSuppressor } from "./lib/suppress-extension-errors.ts";

installExtensionErrorSuppressor();

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error(
		"No se encontró el elemento #root donde montar la aplicación",
	);
}

createRoot(rootElement).render(
	<StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</StrictMode>,
);
