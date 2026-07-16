import type { ReactNode } from "react";

export interface Column<T> {
	key: string;
	label: string;
	render: (item: T) => ReactNode;
	className?: string;
	headerClassName?: string;
}

interface AdminTableProps<T> {
	columns: Column<T>[];
	data: T[];
	getKey: (item: T) => string;
	loading?: boolean;
	total?: number;
	page?: number;
	pageSize?: number;
	onPageChange?: (page: number) => void;
	emptyMessage?: string;
}

function buildPageNumbers(
	current: number,
	total: number,
): (number | "ellipsis")[] {
	if (total <= 7) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}
	const pages: (number | "ellipsis")[] = [1];
	if (current > 3) pages.push("ellipsis");
	const start = Math.max(2, current - 1);
	const end = Math.min(total - 1, current + 1);
	for (let i = start; i <= end; i++) pages.push(i);
	if (current < total - 2) pages.push("ellipsis");
	pages.push(total);
	return pages;
}

function keyedPageNumbers(
	current: number,
	total: number,
): Array<{ key: string; value: number | "ellipsis" }> {
	let previousPage = 0;
	return buildPageNumbers(current, total).map((value) => {
		if (value === "ellipsis") {
			return { key: `ellipsis-after-${previousPage}`, value };
		}
		previousPage = value;
		return { key: `page-${value}`, value };
	});
}

export function AdminTable<T>({
	columns,
	data,
	getKey,
	loading = false,
	total = 0,
	page = 1,
	pageSize = 10,
	onPageChange,
	emptyMessage = "No hay datos disponibles.",
}: AdminTableProps<T>) {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const start = (page - 1) * pageSize + 1;
	const end = Math.min(page * pageSize, total);

	return (
		<div className="admin-table-wrap">
			<div className="admin-table-overflow">
				<table className="admin-table">
					<thead>
						<tr>
							{columns.map((col) => (
								<th key={col.key} className={col.headerClassName ?? ""}>
									{col.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{loading && (
							<tr>
								<td colSpan={columns.length} className="admin-table-loading">
									Cargando...
								</td>
							</tr>
						)}
						{!loading && data.length === 0 && (
							<tr>
								<td colSpan={columns.length} className="admin-table-empty">
									{emptyMessage}
								</td>
							</tr>
						)}
						{!loading &&
							data.map((item) => (
								<tr key={getKey(item)}>
									{columns.map((col) => (
										<td key={col.key} className={col.className ?? ""}>
											{col.render(item)}
										</td>
									))}
								</tr>
							))}
					</tbody>
				</table>
			</div>
			{total > pageSize && onPageChange && (
				<div className="admin-pagination">
					<span className="admin-pagination-info">
						Mostrando{" "}
						<strong>
							{start}-{end}
						</strong>{" "}
						de <strong>{total.toLocaleString("es-ES")}</strong> registros
					</span>
					<div className="admin-pagination-buttons">
						<button
							type="button"
							className="admin-page-nav"
							disabled={page <= 1}
							onClick={() => onPageChange(page - 1)}
							aria-label="Pagina anterior"
						>
							<span className="material-symbols-outlined">chevron_left</span>
						</button>
						{keyedPageNumbers(page, totalPages).map((item) =>
							item.value === "ellipsis" ? (
								<span key={item.key} className="admin-page-ellipsis">
									...
								</span>
							) : (
								<button
									key={item.key}
									type="button"
									className={`admin-page-btn${item.value === page ? " admin-page-btn-active" : ""}`}
									onClick={() => onPageChange(item.value as number)}
									aria-label={`Pagina ${item.value}`}
									aria-current={item.value === page ? "page" : undefined}
								>
									{item.value.toLocaleString("es-ES")}
								</button>
							),
						)}
						<button
							type="button"
							className="admin-page-nav"
							disabled={page >= totalPages}
							onClick={() => onPageChange(page + 1)}
							aria-label="Pagina siguiente"
						>
							<span className="material-symbols-outlined">chevron_right</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
