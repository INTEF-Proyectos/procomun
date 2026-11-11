import {
	type FocusEvent,
	type KeyboardEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { moveHighlight } from "../../lib/keyword-field.ts";
import {
	addCatalogSelection,
	type CatalogGroup,
	type CatalogOption,
	flattenOptionGroups,
	matchCatalogOptions,
} from "../../lib/knowledge-area-field.ts";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";
import "./CatalogMultiSelect.css";

export interface CatalogMultiSelectProps {
	/** Id del buscador; el resto de ids (ayuda, aviso, error) salen de él. */
	id: string;
	/** Nombre del campo: leyenda del fieldset y de la lista de opciones. */
	legend: string;
	searchLabel: string;
	help?: string;
	/** Opciones que se pueden elegir. */
	options: CatalogOption[];
	/** Con grupos, las opciones salen agrupadas en ese orden (bloques). */
	groups?: CatalogGroup[];
	/** Elegidas, con su denominación. */
	selected: CatalogOption[];
	onChange: (ids: string[]) => void;
	max?: number;
	/** Aviso al intentar pasarse de `max`. */
	maxMessage?: string;
	error?: string;
	/** Marca como inactivas las elegidas desactivadas (solo en edición). */
	markInactive?: boolean;
	/** En el buscador el campo es más compacto: el buscador no repite título. */
	variant?: "form" | "filter";
}

/**
 * Selección múltiple con búsqueda en un catálogo cerrado (#448): áreas de
 * conocimiento agrupadas por bloque y familias profesionales. Sigue el patrón
 * combobox con lista (WAI-ARIA APG) como el de palabras clave: las flechas
 * recorren las opciones, Intro elige, Escape cierra, y cada elegida se quita
 * con su propio botón. No admite texto libre.
 */
export function CatalogMultiSelect({
	id,
	legend,
	searchLabel,
	help,
	options,
	groups: groupOrder,
	selected,
	onChange,
	max,
	maxMessage,
	error,
	markInactive = false,
	variant = "form",
}: CatalogMultiSelectProps) {
	const listId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [limitNotice, setLimitNotice] = useState(false);

	const selectedIds = selected.map((option) => option.id);
	const groups = matchCatalogOptions(options, groupOrder, {
		query,
		excludeIds: selectedIds,
	});
	const flat = flattenOptionGroups(groups);
	const expanded = open && flat.length > 0;
	const activeIndex = Math.min(active, flat.length - 1);
	const optionId = (option: CatalogOption) => `${listId}-${option.id}`;
	const helpId = help ? `${id}-help` : undefined;
	const noticeId = `${id}-notice`;
	const errorId = `${id}-error`;

	// La lista tiene altura máxima: la opción resaltada con las flechas se
	// desplaza a la vista para que el resaltado se vea siempre.
	const highlightedId =
		expanded && flat[activeIndex] ? optionId(flat[activeIndex]) : undefined;
	useEffect(() => {
		if (!highlightedId) return;
		document.getElementById(highlightedId)?.scrollIntoView?.({
			block: "nearest",
		});
	}, [highlightedId]);

	let notice = "";
	if (limitNotice && maxMessage) notice = maxMessage;
	else if (open && query.trim() && flat.length === 0)
		notice = m.catalog_multiselect_no_matches();
	else if (expanded)
		notice =
			flat.length === 1
				? m.catalog_multiselect_results_one()
				: m.catalog_multiselect_results_other({ count: String(flat.length) });

	function choose(option: CatalogOption) {
		const next = addCatalogSelection(selectedIds, option.id, max);
		if (next.limitReached) {
			setLimitNotice(true);
			return;
		}
		setLimitNotice(false);
		onChange(next.selected);
		setQuery("");
		setActive(0);
		setOpen(false);
		inputRef.current?.focus();
	}

	function remove(option: CatalogOption) {
		setLimitNotice(false);
		onChange(selectedIds.filter((selectedId) => selectedId !== option.id));
		// El botón desaparece: el foco vuelve al buscador del mismo campo.
		inputRef.current?.focus();
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			if (!open) {
				setOpen(true);
				setActive(delta === 1 ? 0 : Math.max(flat.length - 1, 0));
				return;
			}
			setActive(moveHighlight(activeIndex, delta, flat.length));
			return;
		}
		if (event.key === "Enter") {
			// Intro nunca envía el formulario ni crea valores: solo elige.
			event.preventDefault();
			const highlighted = expanded ? flat[activeIndex] : undefined;
			if (highlighted) choose(highlighted);
			return;
		}
		if (event.key === "Escape" && (open || query)) {
			event.preventDefault();
			if (open) setOpen(false);
			else setQuery("");
		}
	}

	function onBlur(event: FocusEvent<HTMLFieldSetElement>) {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
			setOpen(false);
		}
	}

	function renderOption(option: CatalogOption) {
		const isActive = flat[activeIndex]?.id === option.id;
		// Como en KeywordCatalogField: botón con rol de opción. Fuera del orden
		// de tabulación, porque el foco se queda en el buscador
		// (aria-activedescendant).
		return (
			<button
				key={option.id}
				id={optionId(option)}
				type="button"
				role="option"
				tabIndex={-1}
				aria-selected={isActive}
				className={`catalog-multiselect-option${isActive ? " is-active" : ""}`}
				// Sin esto el buscador pierde el foco antes del clic y la lista se cierra.
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => choose(option)}
			>
				{option.label}
			</button>
		);
	}

	return (
		<fieldset
			className={`catalog-multiselect catalog-multiselect-${variant}`}
			onBlur={onBlur}
		>
			<legend>{legend}</legend>
			{help ? (
				<p id={helpId} className="catalog-multiselect-help">
					{help}
				</p>
			) : null}
			{selected.length > 0 ? (
				<ul
					className="catalog-multiselect-chips"
					aria-label={m.catalog_multiselect_selected({ legend })}
				>
					{selected.map((option) => (
						<li key={option.id}>
							<span>
								{option.label}
								{markInactive && option.active === false
									? ` (${m.catalog_multiselect_inactive()})`
									: ""}
							</span>
							<button
								type="button"
								aria-label={m.catalog_multiselect_remove({
									label: option.label,
								})}
								onClick={() => remove(option)}
							>
								{m.catalog_multiselect_remove_button()}
							</button>
						</li>
					))}
				</ul>
			) : null}
			<label
				htmlFor={id}
				className={
					variant === "filter" ? "sr-only" : "catalog-multiselect-search-label"
				}
			>
				{searchLabel}
			</label>
			<input
				ref={inputRef}
				id={id}
				type="text"
				role="combobox"
				aria-expanded={expanded}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={highlightedId}
				aria-describedby={[helpId, noticeId, errorId].filter(Boolean).join(" ")}
				aria-invalid={error ? "true" : undefined}
				value={query}
				autoComplete="off"
				onChange={(event) => {
					setLimitNotice(false);
					setQuery(event.currentTarget.value);
					setActive(0);
					setOpen(true);
				}}
				onClick={() => setOpen(true)}
				onKeyDown={onKeyDown}
			/>
			{expanded ? (
				<div
					id={listId}
					role="listbox"
					aria-label={legend}
					className="catalog-multiselect-list"
				>
					{groups.map((group) =>
						group.label ? (
							// Un fieldset es un grupo (rol implícito `group`) y su
							// legend le da nombre: cada bloque de la lista.
							<fieldset key={group.id} className="catalog-multiselect-group">
								<legend className="catalog-multiselect-group-label">
									{group.label}
								</legend>
								{group.options.map(renderOption)}
							</fieldset>
						) : (
							group.options.map(renderOption)
						),
					)}
				</div>
			) : null}
			<p id={noticeId} className="catalog-multiselect-notice" role="status">
				{notice}
			</p>
			<span id={errorId} className="catalog-multiselect-error" role="alert">
				{error ?? ""}
			</span>
		</fieldset>
	);
}
