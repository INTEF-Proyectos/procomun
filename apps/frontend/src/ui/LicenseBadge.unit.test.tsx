import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LicenseBadge } from "./LicenseBadge.tsx";

const KNOWN_LICENSES = [
	["cc-by", "https://creativecommons.org/licenses/by/4.0/", "cc-by.png"],
	[
		"cc-by-sa",
		"https://creativecommons.org/licenses/by-sa/4.0/",
		"cc-by-sa.png",
	],
	[
		"cc-by-nc",
		"https://creativecommons.org/licenses/by-nc/4.0/",
		"cc-by-nc.png",
	],
	[
		"cc-by-nc-sa",
		"https://creativecommons.org/licenses/by-nc-sa/4.0/",
		"cc-by-nc-sa.png",
	],
	[
		"cc-by-nd",
		"https://creativecommons.org/licenses/by-nd/4.0/",
		"cc-by-nd.png",
	],
	[
		"cc-by-nc-nd",
		"https://creativecommons.org/licenses/by-nc-nd/4.0/",
		"cc-by-nc-nd.png",
	],
	["cc0", "https://creativecommons.org/publicdomain/zero/1.0/", "cc0.png"],
] as const;

describe("LicenseBadge", () => {
	test("cada licencia del catálogo muestra su botón oficial", () => {
		for (const [code, href, file] of KNOWN_LICENSES) {
			const html = renderToStaticMarkup(<LicenseBadge license={code} />);
			expect(html).toContain(href);
			expect(html).toContain(`licenses/${file}`);
			expect(html).toContain('rel="license noopener noreferrer"');
			expect(html).not.toContain(">copyright<");
		}
	});

	test("acepta el código con espacios y mayúsculas", () => {
		const html = renderToStaticMarkup(<LicenseBadge license="  CC-BY-SA  " />);
		expect(html).toContain("licenses/cc-by-sa.png");
	});
});
