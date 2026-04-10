import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import "./styles/design-tokens.css";
import "./styles/reset.css";
import "./styles/utilities.css";
// Initialize Paraglide locale detection
import "./lib/i18n.ts";

// Set globals expected by existing islands/utilities
(window as Record<string, unknown>).__BASE_URL__ = "/";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</StrictMode>,
);
