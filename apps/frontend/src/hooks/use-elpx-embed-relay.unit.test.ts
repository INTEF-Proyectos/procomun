import { describe, expect, test } from "bun:test";
import {
	createEmbedMessageHandler,
	resolveEmbedMessage,
} from "./use-elpx-embed-relay.ts";

const PAGE_ORIGIN = "https://procomun.example";
const CONTENT_BASE =
	"https://api.procomun.example/api/v1/elpx/abc123/index.html";

// Ventanas falsas: la validación es por identidad de referencia.
const trusted = {} as unknown as Window;
const other = {} as unknown as Window;

function msg(
	source: Window | null,
	data: unknown,
): Pick<MessageEvent, "source" | "data"> {
	return { source, data } as Pick<MessageEvent, "source" | "data">;
}

describe("resolveEmbedMessage", () => {
	const ctx = {
		trustedSource: trusted,
		pageOrigin: PAGE_ORIGIN,
		contentBaseUrl: CONTENT_BASE,
	};

	test("acepta un mensaje válido del iframe de confianza y clasifica el embed", () => {
		const r = resolveEmbedMessage(
			msg(trusted, {
				source: "procomun-elpx-embed",
				action: "play",
				url: "https://www.youtube.com/embed/aqz-KE-bpKQ",
			}),
			ctx,
		);
		expect(r).toEqual({
			kind: "video",
			url: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
		});
	});

	test("rechaza mensajes de una ventana no confiable (no es el iframe de preview)", () => {
		const r = resolveEmbedMessage(
			msg(other, {
				source: "procomun-elpx-embed",
				action: "play",
				url: "https://www.youtube.com/embed/x123456",
			}),
			ctx,
		);
		expect(r).toBeNull();
	});

	test("rechaza mensajes sin la marca esperada", () => {
		expect(
			resolveEmbedMessage(
				msg(trusted, { action: "play", url: "https://x.tv/e/1" }),
				ctx,
			),
		).toBeNull();
		expect(
			resolveEmbedMessage(
				msg(trusted, {
					source: "otra",
					action: "play",
					url: "https://x.tv/e/1",
				}),
				ctx,
			),
		).toBeNull();
	});

	test("rechaza si no hay trustedSource todavía", () => {
		const r = resolveEmbedMessage(
			msg(trusted, {
				source: "procomun-elpx-embed",
				action: "play",
				url: "https://x.tv/e/1",
			}),
			{ ...ctx, trustedSource: null },
		);
		expect(r).toBeNull();
	});

	test("aplica el invariante de la política (rechaza vídeo same-origin)", () => {
		const r = resolveEmbedMessage(
			msg(trusted, {
				source: "procomun-elpx-embed",
				action: "play",
				url: "https://procomun.example/evil/embed",
			}),
			ctx,
		);
		expect(r).toBeNull();
	});
});

describe("createEmbedMessageHandler", () => {
	test("entrega a onEmbed cuando el mensaje es válido", () => {
		const seen: unknown[] = [];
		const handler = createEmbedMessageHandler(
			() => ({
				trustedSource: trusted,
				pageOrigin: PAGE_ORIGIN,
				contentBaseUrl: CONTENT_BASE,
			}),
			(e) => seen.push(e),
		);
		handler(
			msg(trusted, {
				source: "procomun-elpx-embed",
				action: "play",
				url: "https://player.vimeo.com/video/76979871",
			}) as MessageEvent,
		);
		expect(seen).toHaveLength(1);
		expect((seen[0] as { kind: string }).kind).toBe("video");
	});

	test("no llama a onEmbed cuando el mensaje es inválido", () => {
		let called = 0;
		const handler = createEmbedMessageHandler(
			() => ({ trustedSource: trusted, pageOrigin: PAGE_ORIGIN }),
			() => {
				called += 1;
			},
		);
		handler(
			msg(other, {
				source: "procomun-elpx-embed",
				action: "play",
				url: "https://x.tv/e/1",
			}) as MessageEvent,
		);
		expect(called).toBe(0);
	});
});
