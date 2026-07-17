import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import config from "./vite.config.ts";

type Middleware = (
	req: { url?: string },
	res: {
		setHeader: (name: string, value: string) => void;
		end: (content: string) => void;
	},
	next: () => void,
) => void;

function getDashboardMiddleware(): Middleware {
	if (typeof config === "function") {
		throw new Error("Expected static Vite config object.");
	}
	const plugins = Array.isArray(config.plugins) ? config.plugins : [];
	const plugin = plugins[0] as { configureServer?: (server: unknown) => void };
	let middleware: Middleware | undefined;
	plugin.configureServer?.({
		middlewares: {
			use(fn: Middleware) {
				middleware = fn;
			},
		},
	});
	if (!middleware)
		throw new Error("Expected dashboard middleware to be registered.");
	return middleware;
}

describe("frontend Vite config", () => {
	test("mantiene proxy de API hacia el backend local", () => {
		if (typeof config === "function") {
			throw new Error("Expected static Vite config object.");
		}

		const proxy = config.server?.proxy;
		expect(proxy).toBeDefined();
		expect(JSON.stringify(proxy)).toContain("http://localhost:3000");
	});

	test("configura soporte del dashboard dev antes de plugins de framework", () => {
		if (typeof config === "function") {
			throw new Error("Expected static Vite config object.");
		}

		const plugins = Array.isArray(config.plugins) ? config.plugins : [];
		expect(plugins[0]).toMatchObject({ name: "dev-dashboard-support" });
	});

	test("reescribe índices de directorio del dashboard dev", () => {
		const cwd = process.cwd();
		const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
		const middleware = getDashboardMiddleware();
		const req = { url: "/dev/" };
		let nextCalls = 0;

		try {
			process.chdir(frontendRoot);
			middleware(req, { setHeader() {}, end() {} }, () => {
				nextCalls += 1;
			});
		} finally {
			process.chdir(cwd);
		}

		expect(req.url).toBe("/dev/index.html");
		expect(nextCalls).toBe(1);
	});

	test("sirve documentos del repositorio para el dashboard dev", () => {
		const middleware = getDashboardMiddleware();
		const req = { url: "/dev/docs/README.md" };
		const headers = new Map<string, string>();
		let body = "";
		let nextCalls = 0;

		middleware(
			req,
			{
				setHeader(name, value) {
					headers.set(name, value);
				},
				end(content) {
					body = content;
				},
			},
			() => {
				nextCalls += 1;
			},
		);

		expect(headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
		expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(body).toContain("Procom");
		expect(nextCalls).toBe(0);
	});
});
