import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
	plugins: [
		// Serve public/ directory index files (e.g. /dev/ → /dev/index.html)
		// before SPA fallback intercepts them.
		{
			name: "public-dir-index",
			configureServer(server) {
				server.middlewares.use((req, _res, next) => {
					if (req.url?.endsWith("/") && !req.url.startsWith("/api")) {
						const indexPath = join("public", req.url, "index.html");
						if (existsSync(indexPath)) {
							req.url += "index.html";
						}
					}
					next();
				});
			},
		},
		react(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["url", "baseLocale"],
			urlPatterns: [
				{
					pattern: "/:path(.*)?",
					localized: [
						["es", "/:path(.*)?"],
						["en", "/en/:path(.*)?"],
						["ca", "/ca/:path(.*)?"],
						["gl", "/gl/:path(.*)?"],
						["eu", "/eu/:path(.*)?"],
					],
				},
			],
		}),
	],
	server: {
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
		},
	},
	optimizeDeps: {
		exclude: ["@electric-sql/pglite"],
	},
});
