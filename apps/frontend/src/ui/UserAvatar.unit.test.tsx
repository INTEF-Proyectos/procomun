import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UserAvatar } from "./UserAvatar.tsx";

const SRC =
	"https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=80&d=mp";

describe("UserAvatar (#514)", () => {
	test("muestra la imagen recibida con su clase y sin texto alternativo", () => {
		const html = renderToStaticMarkup(
			<UserAvatar
				src={SRC}
				name="Ana"
				className="avatar-img"
				fallbackClassName="avatar-fallback"
			/>,
		);

		expect(html).toContain(`src="${SRC.replace("&", "&amp;")}"`);
		expect(html).toContain('class="avatar-img"');
		expect(html).toContain('alt=""');
		expect(html).not.toContain("avatar-fallback");
	});

	test("sin imagen muestra la inicial del nombre, oculta a lectores de pantalla", () => {
		const html = renderToStaticMarkup(
			<UserAvatar
				src={null}
				name="  ana"
				className="avatar-img"
				fallbackClassName="avatar-fallback"
			/>,
		);

		expect(html).not.toContain("<img");
		expect(html).toBe(
			'<span class="avatar-fallback" aria-hidden="true">A</span>',
		);
	});

	test("usa un signo neutro si no hay nombre", () => {
		const html = renderToStaticMarkup(<UserAvatar src="" name="" />);

		expect(html).toBe('<span aria-hidden="true">?</span>');
	});
});
