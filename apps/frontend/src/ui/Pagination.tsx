import "./Pagination.css";
import "../lib/paraglide-client.ts";
import * as m from "../paraglide/messages.js";

export interface PaginationProps {
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
	className?: string;
}

function getVisiblePages(
	current: number,
	total: number,
): Array<number | "..."> {
	const pages: Array<number | "..."> = [];
	for (let page = 1; page <= total; page++) {
		if (
			page === 1 ||
			page === total ||
			(page >= current - 1 && page <= current + 1)
		) {
			pages.push(page);
		} else if (pages[pages.length - 1] !== "...") {
			pages.push("...");
		}
	}
	return pages;
}

export function Pagination({
	currentPage,
	totalPages,
	onPageChange,
	className = "",
}: PaginationProps) {
	if (totalPages <= 1) return null;

	const pages = getVisiblePages(currentPage, totalPages);
	let previousPage = 0;
	const pageItems = pages.map((page) => {
		if (page === "...") {
			return { key: `ellipsis-after-${previousPage}`, value: page };
		}
		previousPage = page;
		return { key: `page-${page}`, value: page };
	});

	return (
		<nav
			className={`pagination ${className}`.trim()}
			aria-label={m.pagination_label()}
		>
			<button
				type="button"
				className="pagination-btn pagination-prev"
				disabled={currentPage <= 1}
				onClick={() => onPageChange(currentPage - 1)}
				aria-label={m.pagination_previous()}
			>
				<span className="material-symbols-outlined" aria-hidden="true">
					chevron_left
				</span>
				<span className="pagination-btn-text">{m.common_previous()}</span>
			</button>

			<div className="pagination-pages">
				{pageItems.map((item) =>
					item.value === "..." ? (
						<span key={item.key} className="pagination-ellipsis">
							...
						</span>
					) : (
						<button
							key={item.key}
							type="button"
							className={`pagination-page${item.value === currentPage ? " pagination-page-active" : ""}`}
							onClick={() => onPageChange(item.value as number)}
							aria-label={m.pagination_page({ page: String(item.value) })}
							aria-current={item.value === currentPage ? "page" : undefined}
						>
							{item.value}
						</button>
					),
				)}
			</div>

			<button
				type="button"
				className="pagination-btn pagination-next"
				disabled={currentPage >= totalPages}
				onClick={() => onPageChange(currentPage + 1)}
				aria-label={m.pagination_next()}
			>
				<span className="pagination-btn-text">{m.common_next()}</span>
				<span className="material-symbols-outlined" aria-hidden="true">
					chevron_right
				</span>
			</button>
		</nav>
	);
}
