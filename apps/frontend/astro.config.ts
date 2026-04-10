import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

export default defineConfig({
	site: "https://procomun.es",
	base: "/",
	output: "static",
	integrations: [react()],
	i18n: {
		defaultLocale: "es",
		locales: ["es", "en", "ca", "gl", "eu"],
		routing: {
			prefixDefaultLocale: false,
		},
	},
	vite: {
		plugins: [
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
	},
});
