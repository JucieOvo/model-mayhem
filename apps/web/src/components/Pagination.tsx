/**
 * 固定区域分页控件。
 *
 * 作者：JucieOvo
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
}) {
  return (
    <nav className="pagination-bar" aria-label="分页">
      <span className="pagination-total">共 {total} 项</span>
      <button
        type="button"
        className="ghost-button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft size={16} />
        上一页
      </button>
      <span className="pagination-page">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        className="ghost-button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
