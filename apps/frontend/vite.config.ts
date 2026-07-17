import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// Serve public/ directory index files and repo docs for /dev/ dashboard.
		{
			name: "dev-dashboard-support",
			configureServer(server) {
				const repoRoot = resolve(__dirname, "../..");
				server.middlewares.use((req, res, next) => {
					// Directory index: /dev/ → /dev/index.html
					if (req.url?.endsWith("/") && !req.url.startsWith("/api")) {
						const indexPath = join("public", req.url, "index.html");
						if (existsSync(indexPath)) {
							req.url += "index.html";
						}
					}
					// Serve repo docs at /dev/docs/* for the dashboard
					if (req.url?.startsWith("/dev/docs/")) {
						const relPath = req.url.slice("/dev/docs/".length);
						const filePath = join(repoRoot, decodeURIComponent(relPath));
						if (filePath.startsWith(repoRoot) && existsSync(filePath)) {
							const content = readFileSync(filePath, "utf-8");
							res.setHeader("Content-Type", "text/plain; charset=utf-8");
							res.setHeader("Access-Control-Allow-Origin", "*");
							res.end(content);
							return;
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
});
