import {
	KEYWORD_MESSAGES,
	normalizeKeywordKey,
} from "@procomun/db/keyword-catalog";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import type {
	CatalogKeyword,
	KeywordSuggestion,
} from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import {
	addKeyword,
	keywordFieldNotice,
	moveHighlight,
} from "../../lib/keyword-field.ts";

type KeywordCatalogFieldProps = {
	id?: string;
	label?: string;
	selected: CatalogKeyword[];
	onChange: (next: CatalogKeyword[]) => void;
	/** Admin y curator: acción explícita para dar de alta un término. */
	canCreate?: boolean;
	/** Filtro del buscador: sin ayuda y con las etiquetas libres anteriores. */
	filter?: boolean;
	/**
	 * Añade las etiquetas libres a las sugerencias; por defecto, solo en el
	 * filtro. Las colecciones no tienen etiquetas libres y lo desactivan.
	 */
	includeTags?: boolean;
};

const MATCH_SUFFIX = { label: "", alias: " (alias)", tag: " (etiqueta)" };

export function KeywordCatalogField({
	id = "keywords",
	label = "Palabras clave",
	selected,
	onChange,
	canCreate = false,
	filter = false,
	includeTags = filter,
}: KeywordCatalogFieldProps) {
	const listId = useId();
	const [query, setQuery] = useState("");
	const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
	const [searching, setSearching] = useState(false);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [message, setMessage] = useState<string | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [aliases, setAliases] = useState("");
	const [createError, setCreateError] = useState("");
	const [duplicate, setDuplicate] = useState<CatalogKeyword | null>(null);

	useEffect(() => {
		const term = query.trim();
		setConfirming(false);
		setCreateError("");
		setDuplicate(null);
		if (!term) {
			setSuggestions([]);
			setSearching(false);
			setOpen(false);
			return;
		}
		let cancelled = false;
		setSearching(true);
		const timer = setTimeout(() => {
			void getApiClient()
				.then((api) => api.searchKeywords(term, includeTags))
				.then((data) => {
					if (cancelled) return;
					setSuggestions(data);
					setActive(0);
					setOpen(true);
				})
				.catch(() => {
					if (!cancelled) setSuggestions([]);
				})
				.finally(() => {
					if (!cancelled) setSearching(false);
				});
		}, 200);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, includeTags]);

	function select(keyword: CatalogKeyword) {
		const next = addKeyword(selected, keyword);
		setMessage(next.message);
		if (next.selected === selected) return;
		onChange(next.selected);
		setQuery("");
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
			setActive((current) =>
				moveHighlight(
					current,
					event.key === "ArrowDown" ? 1 : -1,
					suggestions.length,
				),
			);
			return;
		}
		if (event.key !== "Enter") return;
		// Intro solo elige la sugerencia resaltada: el texto libre no crea nada.
		event.preventDefault();
		const highlighted = open ? suggestions[active] : undefined;
		if (highlighted) select(highlighted);
	}

	async function create() {
		const api = await getApiClient();
		const result = await api.createCatalogKeyword({
			label: query.trim(),
			aliases: aliases
				.split(",")
				.map((alias) => alias.trim())
				.filter(Boolean),
		});
		if (result.keyword && result.status === 201) {
			setAliases("");
			setConfirming(false);
			select(result.keyword);
			return;
		}
		setCreateError(result.error ?? "No se pudo crear la palabra clave");
		setDuplicate(result.keyword ?? null);
	}

	const notice =
		message ??
		keywordFieldNotice({
			query,
			matchCount: suggestions.length,
			selectedCount: selected.length,
			canCreate,
			searching,
		});
	const exactMatch = suggestions.some(
		(item) =>
			item.match === "label" &&
			normalizeKeywordKey(item.label) === normalizeKeywordKey(query),
	);
	const helpId = filter ? undefined : `${id}-help`;

	return (
		<div className="keyword-field">
			<label htmlFor={id}>{label}</label>
			{helpId ? (
				<p id={helpId} className="keyword-field-help">
					{KEYWORD_MESSAGES.help}
				</p>
			) : null}
			{selected.length > 0 ? (
				<ul className="keyword-field-chips">
					{selected.map((item) => (
						<li key={item.id}>
							<span>{item.label}</span>
							<button
								type="button"
								aria-label={`Quitar ${item.label}`}
								onClick={() => {
									setMessage(null);
									onChange(selected.filter((k) => k.id !== item.id));
								}}
							>
								Quitar
							</button>
						</li>
					))}
				</ul>
			) : null}
			<input
				id={id}
				type="text"
				role="combobox"
				aria-expanded={open && suggestions.length > 0}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={
					open && suggestions[active] ? `${listId}-${active}` : undefined
				}
				aria-describedby={helpId}
				value={query}
				autoComplete="off"
				onChange={(event) => {
					setMessage(null);
					setQuery(event.currentTarget.value);
				}}
				onKeyDown={onKeyDown}
			/>
			{open && suggestions.length > 0 ? (
				<div id={listId} className="keyword-field-list" role="listbox">
					{suggestions.map((item, index) => (
						<button
							key={item.id}
							id={`${listId}-${index}`}
							type="button"
							role="option"
							aria-selected={index === active}
							onClick={() => select(item)}
						>
							{item.label}
							{MATCH_SUFFIX[item.match]}
						</button>
					))}
				</div>
			) : null}
			{notice ? (
				<p className="keyword-field-notice" role="status">
					{notice}
				</p>
			) : null}
			{canCreate && query.trim() && !searching && !exactMatch ? (
				<div className="keyword-field-create">
					{confirming ? (
						<>
							<p>{KEYWORD_MESSAGES.guidance}</p>
							<label htmlFor={`${id}-aliases`}>
								Alias, separados por comas (opcional)
							</label>
							<input
								id={`${id}-aliases`}
								type="text"
								value={aliases}
								onChange={(event) => setAliases(event.currentTarget.value)}
							/>
							<button type="button" onClick={() => void create()}>
								Crear «{query.trim()}»
							</button>
							<button type="button" onClick={() => setConfirming(false)}>
								Cancelar
							</button>
						</>
					) : (
						<button type="button" onClick={() => setConfirming(true)}>
							Añadir «{query.trim()}» al catálogo
						</button>
					)}
					{createError ? <p role="alert">{createError}</p> : null}
					{duplicate ? (
						<button type="button" onClick={() => select(duplicate)}>
							Usar «{duplicate.label}»
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
