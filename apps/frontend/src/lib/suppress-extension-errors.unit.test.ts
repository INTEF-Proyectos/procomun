import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	installExtensionErrorSuppressor,
	isExtensionError,
} from "./suppress-extension-errors.ts";

describe("suppress-extension-errors", () => {
	describe("isExtensionError", () => {
		test("detects 'message channel closed' error", () => {
			const err = new Error(
				"A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
			);
			expect(isExtensionError(err)).toBe(true);
		});

		test("detects 'message port closed' variant", () => {
			const err = new Error(
				"The message port closed before a response was received",
			);
			expect(isExtensionError(err)).toBe(true);
		});

		test("detects string reason (not Error instance)", () => {
			expect(
				isExtensionError(
					"the message channel closed before a response was received",
				),
			).toBe(true);
		});

		test("does not match unrelated errors", () => {
			expect(isExtensionError(new Error("Network request failed"))).toBe(false);
			expect(isExtensionError(new TypeError("Cannot read property 'x'"))).toBe(
				false,
			);
			expect(isExtensionError(null)).toBe(false);
			expect(isExtensionError(undefined)).toBe(false);
		});
	});

	describe("installExtensionErrorSuppressor", () => {
		/** The slice of PromiseRejectionEvent the suppressor actually touches. */
		type FakeRejectionEvent = {
			reason: unknown;
			defaultPrevented: boolean;
			preventDefault(): void;
		};
		type Listener = (event: FakeRejectionEvent) => void;
		type FakeWindow = {
			addEventListener(type: string, listener: Listener): void;
			removeEventListener(type: string, listener: Listener): void;
		};

		const globalWithWindow = globalThis as unknown as { window?: FakeWindow };
		let fakeListeners: Listener[];
		const originalWindow = globalWithWindow.window;

		beforeEach(() => {
			fakeListeners = [];
			globalWithWindow.window = {
				addEventListener(_type, listener) {
					fakeListeners.push(listener);
				},
				removeEventListener(_type, listener) {
					fakeListeners = fakeListeners.filter((l) => l !== listener);
				},
			};
		});

		afterEach(() => {
			globalWithWindow.window = originalWindow;
		});

		test("prevents extension errors from propagating", () => {
			const cleanup = installExtensionErrorSuppressor();

			const event = {
				reason: new Error(
					"A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
				),
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				},
			};

			for (const listener of fakeListeners) listener(event);
			expect(event.defaultPrevented).toBe(true);
			cleanup();
		});

		test("does NOT suppress unrelated errors", () => {
			const cleanup = installExtensionErrorSuppressor();

			const event = {
				reason: new Error("Some real application error"),
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				},
			};

			for (const listener of fakeListeners) listener(event);
			expect(event.defaultPrevented).toBe(false);
			cleanup();
		});

		test("cleanup removes the handler", () => {
			const cleanup = installExtensionErrorSuppressor();
			cleanup();

			const event = {
				reason: new Error(
					"the message channel closed before a response was received",
				),
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				},
			};

			for (const listener of fakeListeners) listener(event);
			// After cleanup, no listeners remain — error is not suppressed
			expect(event.defaultPrevented).toBe(false);
		});
	});
});
