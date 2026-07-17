import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	fullyParallel: true,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: isCI ? 1 : undefined,
	reporter: isCI
		? [["html", { open: "never" }], ["github"]]
		: [["html", { open: "on-failure" }]],

	expect: {
		timeout: isCI ? 15_000 : 5_000,
	},

	use: {
		baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",
		headless: true,
		screenshot: "only-on-failure",
		trace: "on-first-retry",
		video: "on-first-retry",
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "firefox",
			use: { ...devices["Desktop Firefox"] },
		},
		{
			name: "webkit",
			use: { ...devices["Desktop Safari"] },
		},
		{
			name: "mobile-chrome",
			use: { ...devices["Pixel 5"] },
		},
		{
			name: "mobile-safari",
			use: { ...devices["iPhone 13"] },
		},
	],
});
