import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

export default defineConfig({
	plugins: [
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
