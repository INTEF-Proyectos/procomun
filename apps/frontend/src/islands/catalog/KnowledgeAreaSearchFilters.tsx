import type { PublicKnowledgeAreaCatalog } from "../../lib/api-client.ts";
import {
	catalogAreaOptions,
	selectedCatalogOptions,
	showsProfessionalFamilies,
} from "../../lib/knowledge-area-field.ts";
import { CatalogMultiSelect } from "../resources/CatalogMultiSelect.tsx";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";

/**
 * Filtros del buscador por área de conocimiento y familia profesional (#448).
 * Dentro de cada filtro vale cualquiera de los valores elegidos. Las áreas
 * desactivadas se ofrecen igual: sus recursos se siguen pudiendo localizar.
 * Las familias solo aparecen con la etapa Formación Profesional.
 */
export function KnowledgeAreaSearchFilters({
	catalog,
	educationalCategory,
	knowledgeAreas,
	professionalFamilies,
	includeProfessionalFamilies = true,
	areaHelp = m.knowledge_areas_filter_help(),
	onChange,
}: {
	catalog: PublicKnowledgeAreaCatalog | null;
	educationalCategory: string;
	knowledgeAreas: string[];
	professionalFamilies: string[];
	includeProfessionalFamilies?: boolean;
	areaHelp?: string;
	onChange: (next: {
		knowledgeAreas: string[];
		professionalFamilies: string[];
	}) => void;
}) {
	const areaOptions = catalogAreaOptions(catalog?.areas ?? []);
	const families = catalog?.professionalFamilies ?? [];
	return (
		<>
			<div className="filter-group">
				<CatalogMultiSelect
					id="filter-knowledgeAreas"
					variant="filter"
					legend={m.knowledge_areas_label()}
					searchLabel={m.knowledge_areas_search()}
					help={areaHelp}
					options={areaOptions}
					groups={catalog?.blocks}
					selected={selectedCatalogOptions(knowledgeAreas, areaOptions)}
					onChange={(ids) =>
						onChange({ knowledgeAreas: ids, professionalFamilies })
					}
				/>
			</div>
			{includeProfessionalFamilies &&
			showsProfessionalFamilies([educationalCategory]) ? (
				<div className="filter-group">
					<CatalogMultiSelect
						id="filter-professionalFamilies"
						variant="filter"
						legend={m.professional_families_label()}
						searchLabel={m.professional_families_search()}
						help={m.professional_families_filter_help()}
						options={families}
						selected={selectedCatalogOptions(professionalFamilies, families)}
						onChange={(ids) =>
							onChange({ knowledgeAreas, professionalFamilies: ids })
						}
					/>
				</div>
			) : null}
		</>
	);
}
