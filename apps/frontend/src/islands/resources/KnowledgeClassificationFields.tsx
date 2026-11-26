import {
	KNOWLEDGE_AREA_FIELD,
	MAX_KNOWLEDGE_AREAS,
	PROFESSIONAL_FAMILY_FIELD,
} from "@procomun/db/knowledge-areas";
import { useEffect, useRef } from "react";
import type {
	PublicKnowledgeAreaCatalog,
	ResourceKnowledgeArea,
} from "../../lib/api-client.ts";
import {
	type CatalogOption,
	familiesPendingRemoval,
	formAreaOptions,
	selectedCatalogOptions,
	showsProfessionalFamilies,
} from "../../lib/knowledge-area-field.ts";
import { CatalogMultiSelect } from "./CatalogMultiSelect.tsx";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";

/**
 * Campos «Áreas de conocimiento» y «Familia profesional» del alta y la
 * edición del recurso (#448). Los ids de los campos (`{idPrefix}-...`) y los
 * errores se nombran como en la API: `knowledgeAreaIds`, `professionalFamilyIds`.
 */

const EMPTY_CATALOG: PublicKnowledgeAreaCatalog = {
	blocks: [],
	areas: [],
	professionalFamilies: [],
};

/**
 * Aviso cuando el catálogo no carga, con un botón para volver a pedirlo
 * (#626). Sin él, el selector se queda sin opciones y nadie sabe por qué.
 */
export function KnowledgeCatalogError({
	onRetry,
	focusId,
}: {
	onRetry: () => void;
	/** Campo que recibe el foco cuando el reintento funciona y el aviso se va. */
	focusId?: string;
}) {
	const retried = useRef(false);
	// El aviso desaparece al cargar el catálogo y se llevaría el foco del
	// botón: pasa al campo que acaba de recibir las opciones.
	useEffect(
		() => () => {
			if (retried.current && focusId) document.getElementById(focusId)?.focus();
		},
		[focusId],
	);
	return (
		<p className="catalog-multiselect-error" role="alert">
			{m.knowledge_areas_load_error()}{" "}
			<button
				type="button"
				onClick={() => {
					retried.current = true;
					onRetry();
				}}
			>
				{m.knowledge_areas_retry()}
			</button>
		</p>
	);
}

export function KnowledgeAreaField({
	idPrefix,
	catalog,
	selectedIds,
	onChange,
	error,
	resourceAreas = [],
	onCatalogRetry,
	requiredToPublish = true,
}: {
	idPrefix: string;
	catalog: PublicKnowledgeAreaCatalog | null;
	selectedIds: string[];
	onChange: (ids: string[]) => void;
	error?: string;
	/** Las que ya tiene el recurso: dan la denominación si el catálogo no carga. */
	resourceAreas?: ResourceKnowledgeArea[];
	/** Solo si la carga del catálogo ha fallado: muestra el aviso y reintenta. */
	onCatalogRetry?: () => void;
	/** Los recursos necesitan un área para publicarse; las colecciones no. */
	requiredToPublish?: boolean;
}) {
	const { areas, blocks } = catalog ?? EMPTY_CATALOG;
	const options = formAreaOptions(areas, selectedIds);
	const fallback: CatalogOption[] = resourceAreas.map((area) => ({
		id: area.id,
		label: area.label,
		groupId: area.blockId,
		active: area.active,
	}));
	return (
		<>
			{onCatalogRetry ? (
				<KnowledgeCatalogError
					onRetry={onCatalogRetry}
					focusId={`${idPrefix}-${KNOWLEDGE_AREA_FIELD}`}
				/>
			) : null}
			<CatalogMultiSelect
				id={`${idPrefix}-${KNOWLEDGE_AREA_FIELD}`}
				legend={m.knowledge_areas_label()}
				searchLabel={m.knowledge_areas_search()}
				help={(requiredToPublish
					? m.knowledge_areas_help
					: m.collections_knowledge_areas_help)({
					max: String(MAX_KNOWLEDGE_AREAS),
				})}
				options={options}
				groups={blocks}
				selected={selectedCatalogOptions(selectedIds, options, fallback)}
				onChange={onChange}
				max={MAX_KNOWLEDGE_AREAS}
				maxMessage={m.knowledge_areas_max({ max: String(MAX_KNOWLEDGE_AREAS) })}
				error={error}
				markInactive
			/>
		</>
	);
}

/**
 * Solo con Formación Profesional. Si se quita FP con familias elegidas, el
 * campo desaparece y queda un aviso: al guardar se borran. Si se vuelve a
 * elegir FP antes de guardar, reaparecen.
 */
export function ProfessionalFamilyField({
	idPrefix,
	catalog,
	categoryIds,
	selectedIds,
	onChange,
	error,
}: {
	idPrefix: string;
	catalog: PublicKnowledgeAreaCatalog | null;
	categoryIds: string[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
	error?: string;
}) {
	const families = (catalog ?? EMPTY_CATALOG).professionalFamilies;
	const selected = selectedCatalogOptions(selectedIds, families);
	const warning = familiesPendingRemoval(categoryIds, selectedIds)
		? m.professional_families_will_be_removed({
				families: selected.map((family) => family.label).join(", "),
			})
		: "";
	return (
		<>
			{/* Región viva siempre presente: el aviso se anuncia al aparecer. */}
			<p className="catalog-multiselect-warning" role="status">
				{warning}
			</p>
			{showsProfessionalFamilies(categoryIds) ? (
				<CatalogMultiSelect
					id={`${idPrefix}-${PROFESSIONAL_FAMILY_FIELD}`}
					legend={m.professional_families_label()}
					searchLabel={m.professional_families_search()}
					help={m.professional_families_help()}
					options={families}
					selected={selected}
					onChange={onChange}
					error={error}
				/>
			) : null}
		</>
	);
}
