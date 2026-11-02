import { type FormEvent, useCallback, useEffect, useState } from "react";
import type {
	KnowledgeAreaCatalog,
	KnowledgeAreaRecord,
} from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { ModalFrame } from "../shared/ModalFrame.tsx";
import { AdminTable, type Column } from "./AdminTable.tsx";
import {
	filterKnowledgeAreas,
	type KnowledgeAreaStatusFilter,
	knowledgeAreaErrorMessage,
} from "./knowledge-area-admin.ts";

const EMPTY_CATALOG: KnowledgeAreaCatalog = {
	blocks: [],
	areas: [],
	professionalFamilies: [],
};

type FormState = { label: string; description: string; blockId: string };

/**
 * Catálogo de áreas de conocimiento (issue #448, ADR-0045). Admin y curator
 * crean, editan, mueven de bloque y desactivan áreas. No se borran: un área
 * desactivada conserva sus recursos y deja de ofrecerse.
 */
export function AdminKnowledgeAreasSection() {
	const [catalog, setCatalog] = useState<KnowledgeAreaCatalog>(EMPTY_CATALOG);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState("");
	const [q, setQ] = useState("");
	const [blockId, setBlockId] = useState("");
	const [status, setStatus] = useState<KnowledgeAreaStatusFilter>("all");
	const [statusMsg, setStatusMsg] = useState("");

	// null: cerrado; "new": alta; un área: edición.
	const [editing, setEditing] = useState<KnowledgeAreaRecord | "new" | null>(
		null,
	);
	const [form, setForm] = useState<FormState>({
		label: "",
		description: "",
		blockId: "",
	});
	const [formBusy, setFormBusy] = useState(false);
	const [formError, setFormError] = useState("");
	const [toggleBusy, setToggleBusy] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const api = await getApiClient();
			setCatalog(await api.listAdminKnowledgeAreas());
			setLoadError("");
		} catch {
			setLoadError("No se pudo cargar el catálogo de áreas.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const blockLabel = (id: string) =>
		catalog.blocks.find((block) => block.id === id)?.label ?? id;

	function openCreate() {
		setEditing("new");
		setForm({ label: "", description: "", blockId: blockId || "" });
		setFormError("");
	}

	function openEdit(area: KnowledgeAreaRecord) {
		setEditing(area);
		setForm({
			label: area.label,
			description: area.description ?? "",
			blockId: area.blockId,
		});
		setFormError("");
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		if (!editing) return;
		setFormBusy(true);
		setFormError("");
		try {
			const api = await getApiClient();
			const input = {
				label: form.label,
				description: form.description.trim() || null,
				blockId: form.blockId,
			};
			const saved =
				editing === "new"
					? await api.createAdminKnowledgeArea(input)
					: await api.updateAdminKnowledgeArea(editing.id, input);
			setEditing(null);
			setStatusMsg(
				editing === "new"
					? `Área «${saved.label}» creada.`
					: `Área «${saved.label}» guardada.`,
			);
			await load();
		} catch (err) {
			setFormError(
				knowledgeAreaErrorMessage(err, "No se pudo guardar el área."),
			);
		} finally {
			setFormBusy(false);
		}
	}

	async function toggleActive(area: KnowledgeAreaRecord) {
		setToggleBusy(area.id);
		try {
			const api = await getApiClient();
			const saved = await api.updateAdminKnowledgeArea(area.id, {
				active: !area.active,
			});
			setStatusMsg(
				saved.active
					? `Área «${saved.label}» activada.`
					: `Área «${saved.label}» desactivada: deja de ofrecerse y sus recursos la conservan.`,
			);
			await load();
		} catch (err) {
			setStatusMsg(
				knowledgeAreaErrorMessage(
					err,
					"No se pudo cambiar el estado del área.",
				),
			);
		} finally {
			setToggleBusy(null);
		}
	}

	const rows = filterKnowledgeAreas(catalog.areas, { q, blockId, status });

	const columns: Column<KnowledgeAreaRecord>[] = [
		{
			key: "label",
			label: "Área",
			render: (area) => (
				<div>
					<div className="admin-resource-title">{area.label}</div>
					{area.description ? (
						<div className="admin-collection-meta">{area.description}</div>
					) : null}
				</div>
			),
		},
		{
			key: "block",
			label: "Bloque",
			render: (area) => (
				<span className="admin-collection-meta">
					{blockLabel(area.blockId)}
				</span>
			),
		},
		{
			key: "usage",
			label: "Recursos",
			render: (area) => (
				<span className="admin-collection-meta">{area.usageCount}</span>
			),
		},
		{
			key: "status",
			label: "Estado",
			render: (area) => (
				<span
					className={`admin-active-badge ${
						area.active
							? "admin-active-badge--active"
							: "admin-active-badge--inactive"
					}`}
				>
					{area.active ? "Activa" : "Inactiva"}
				</span>
			),
		},
		{
			key: "actions",
			label: "Acciones",
			headerClassName: "admin-table-th-right",
			render: (area) => (
				<div className="admin-actions-cell">
					<button
						type="button"
						className="admin-action-btn admin-action-btn--edit"
						onClick={() => openEdit(area)}
						aria-label={`Editar ${area.label}`}
					>
						<span className="material-symbols-outlined" aria-hidden="true">
							edit
						</span>
					</button>
					<button
						type="button"
						className="admin-toggle-btn"
						disabled={toggleBusy === area.id}
						onClick={() => void toggleActive(area)}
						aria-label={`${area.active ? "Desactivar" : "Activar"} ${area.label}`}
					>
						{area.active ? "Desactivar" : "Activar"}
					</button>
				</div>
			),
		},
	];

	return (
		<>
			<div className="admin-section-header">
				<h1>Áreas de conocimiento</h1>
				<p>
					Catálogo de áreas que se asignan a los recursos (máximo 3 por
					recurso). Los bloques son fijos. Un área no se borra: al desactivarla
					deja de ofrecerse y los recursos que ya la tienen la conservan.
				</p>
			</div>

			<div className="admin-filter-bar">
				<div className="admin-filter-bar-inner">
					<div className="admin-filter-search">
						<label className="admin-filter-label" htmlFor="areas-search">
							Buscar área
						</label>
						<div className="admin-search-wrap">
							<input
								id="areas-search"
								type="search"
								className="admin-search-input"
								placeholder="Denominación o descripción..."
								value={q}
								onChange={(e) => setQ(e.target.value)}
							/>
							<span
								className="material-symbols-outlined admin-search-icon"
								aria-hidden="true"
							>
								search
							</span>
						</div>
					</div>
					<div className="admin-form-field">
						<label htmlFor="areas-block-filter">Bloque</label>
						<select
							id="areas-block-filter"
							value={blockId}
							onChange={(e) => setBlockId(e.target.value)}
						>
							<option value="">Todos</option>
							{catalog.blocks.map((block) => (
								<option key={block.id} value={block.id}>
									{block.label}
								</option>
							))}
						</select>
					</div>
					<div className="admin-form-field">
						<label htmlFor="areas-status-filter">Estado</label>
						<select
							id="areas-status-filter"
							value={status}
							onChange={(e) =>
								setStatus(e.target.value as KnowledgeAreaStatusFilter)
							}
						>
							<option value="all">Todas</option>
							<option value="active">Activas</option>
							<option value="inactive">Inactivas</option>
						</select>
					</div>
					<div style={{ display: "flex", alignItems: "flex-end" }}>
						<button
							type="button"
							className="admin-form-btn admin-form-btn--primary"
							style={{ height: "3.5rem" }}
							onClick={openCreate}
						>
							Nueva área
						</button>
					</div>
				</div>
				{statusMsg || loadError ? (
					<p className="admin-list-status" role="status">
						{loadError || statusMsg}
					</p>
				) : null}
			</div>

			<AdminTable<KnowledgeAreaRecord>
				columns={columns}
				data={rows}
				getKey={(area) => area.id}
				loading={loading}
				emptyMessage="No hay áreas para los filtros actuales."
			/>

			<details className="admin-filter-bar">
				<summary>
					Familias profesionales ({catalog.professionalFamilies.length})
				</summary>
				<p className="admin-collection-meta">
					Lista oficial de Formación Profesional. Se actualiza con un cambio de
					código, no desde este panel.
				</p>
				<ul>
					{catalog.professionalFamilies.map((family) => (
						<li key={family.id}>{family.label}</li>
					))}
				</ul>
			</details>

			{editing ? (
				<ModalFrame
					open
					className="admin-edit-dialog"
					titleId="knowledge-area-form-title"
					onClose={() => setEditing(null)}
				>
					<form onSubmit={(e) => void handleSubmit(e)}>
						<h2 id="knowledge-area-form-title">
							{editing === "new" ? "Nueva área" : `Editar «${editing.label}»`}
						</h2>
						<div className="admin-form-field">
							<label htmlFor="knowledge-area-label">Denominación</label>
							<input
								id="knowledge-area-label"
								value={form.label}
								maxLength={120}
								onChange={(e) => setForm({ ...form, label: e.target.value })}
								required
							/>
						</div>
						<div className="admin-form-field">
							<label htmlFor="knowledge-area-description">
								Descripción (opcional)
							</label>
							<textarea
								id="knowledge-area-description"
								rows={3}
								maxLength={1000}
								value={form.description}
								onChange={(e) =>
									setForm({ ...form, description: e.target.value })
								}
							/>
						</div>
						<div className="admin-form-field">
							<label htmlFor="knowledge-area-block">Bloque</label>
							<select
								id="knowledge-area-block"
								value={form.blockId}
								onChange={(e) => setForm({ ...form, blockId: e.target.value })}
								required
							>
								<option value="">Selecciona...</option>
								{catalog.blocks.map((block) => (
									<option key={block.id} value={block.id}>
										{block.label}
									</option>
								))}
							</select>
						</div>
						{formError ? (
							<p className="admin-form-error" role="alert">
								{formError}
							</p>
						) : null}
						<div className="admin-dialog-actions">
							<button
								type="button"
								className="admin-btn"
								onClick={() => setEditing(null)}
							>
								Cancelar
							</button>
							<button
								type="submit"
								className="admin-btn admin-btn--primary"
								disabled={formBusy}
							>
								{formBusy ? "Guardando..." : "Guardar"}
							</button>
						</div>
					</form>
				</ModalFrame>
			) : null}
		</>
	);
}
