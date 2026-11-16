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
		watch: {
			// #492. La primera vez que el SDK de inlang abre el proyecto en una
			// copia limpia (CI, Docker) escribe dentro de project.inlang/:
			// settings.json, .lix/, .meta.json, README.md, .gitignore y cache/.
			// El plugin de Paraglide lee esos ficheros y los trata como entrada,
			// así que el watcher de Vite le avisaba de esas escrituras mientras
			// compilaba en buildStart. Lanzaba otra compilación, todavía sin los
			// hashes de la primera, que reescribía todo src/paraglide con Vite ya
			// escuchando. El navegador recibía `page reload src/paraglide/runtime.js`
			// en mitad del primer test e2e. messages/*.json sigue vigilado. Si se
			// cambia settings.json hay que reiniciar Vite, como con los
			// urlPatterns de arriba.
			ignored: ["**/project.inlang/**"],
		},
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
		},
	},
});
