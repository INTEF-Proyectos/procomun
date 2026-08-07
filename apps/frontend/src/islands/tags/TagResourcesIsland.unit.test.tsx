import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TagResourcesIsland } from "./TagResourcesIsland.tsx";

describe("TagResourcesIsland (#310)", () => {
	test("muestra el shell de carga al montar con slug", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/tags/robotica"]}>
				<Routes>
					<Route path="/tags/:slug" element={<TagResourcesIsland />} />
				</Routes>
			</MemoryRouter>,
		);
		// Skeleton / loading shell (sin datos async en SSR)
		expect(html.length).toBeGreaterThan(20);
		expect(html).toMatch(/tag-page|Skeleton|skeleton/i);
	});
});
