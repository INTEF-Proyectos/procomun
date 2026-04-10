import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import "./styles/design-tokens.css";
import "./styles/reset.css";
import "./styles/utilities.css";
// Initialize Paraglide locale detection (reads <html lang> set by index.html)
import "./lib/i18n.ts";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</StrictMode>,
);
