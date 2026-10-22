import { describe, expect, mock, test } from "bun:test";
import type { FormEvent, ReactElement } from "react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

type FormProps = { onSubmit: (event: FormEvent<HTMLFormElement>) => void };

describe("ConfirmDialog", () => {
	test("confirmar no envía el formulario que lo contiene (#393)", () => {
		// En la edición del recurso el diálogo cuelga del <form> de la ficha: si el
		// submit burbujease, confirmar el borrado guardaría además los cambios.
		const onConfirm = mock(() => {});
		const frame = ConfirmDialog({
			open: true,
			title: "Eliminar recurso",
			message: "¿Seguro?",
			confirmLabel: "Eliminar recurso",
			onCancel: () => {},
			onConfirm,
		}) as ReactElement<{ children: ReactElement<FormProps> }>;
		const form = frame.props.children;
		const event = {
			preventDefault: mock(() => {}),
			stopPropagation: mock(() => {}),
		};

		form.props.onSubmit(event as unknown as FormEvent<HTMLFormElement>);

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
	});
});
