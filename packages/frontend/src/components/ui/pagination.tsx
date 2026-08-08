import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Configurable page size options, kept in sync with the backend allowed set. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  /** Current 1-based page number. */
  page: number;
  /** Total number of pages available. */
  totalPages: number;
  /** Total number of records across all pages. */
  total: number;
  /** Current page size (records per page). */
  pageSize: number;
  /** Called when the user navigates to a different page. */
  onPageChange: (page: number) => void;
  /** Called when the user changes the page size. */
  onPageSizeChange: (pageSize: number) => void;
  /** Disables navigation while data is loading to prevent double-fetch. */
  disabled?: boolean;
  className?: string;
}

/** Build the page-number list with ellipsis truncation for large page counts. */
function buildPageItems(page: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push('ellipsis');
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < totalPages - 1) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

/** Accessible icon-only navigation button. */
function NavButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
}

/**
 * Reusable pagination control: page numbers, previous/next, first/last
 * shortcuts, ellipsis truncation, a page-size selector, and a result summary.
 * Responsive: collapses to prev/next + compact indicator on small screens.
 */
function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  className,
}: PaginationProps) {
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <div
      data-slot="pagination"
      className={cn(
        'flex flex-col gap-3 border-t border-ink-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      {/* Result summary + page size selector */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-500">
        <span aria-live="polite">
          Showing{' '}
          <span className="font-medium text-ink-700">
            {firstItem}–{lastItem}
          </span>{' '}
          of <span className="font-medium text-ink-700">{total}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-400">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[4.5rem] text-xs" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Navigation controls */}
      <nav
        aria-label="Pagination"
        className="flex items-center justify-center gap-1 sm:justify-end"
      >
        <NavButton
          label="First page"
          icon={<ChevronsLeft />}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(1)}
        />
        <NavButton
          label="Previous page"
          icon={<ChevronLeft />}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        />

        {/* Page numbers (hidden on small screens, shown on sm+) */}
        <div className="hidden items-center gap-1 sm:flex">
          {buildPageItems(page, totalPages).map((item, index) =>
            item === 'ellipsis' ? (
              <span
                key={`ellipsis-${index}`}
                className="px-1 text-sm text-ink-400"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === page ? 'default' : 'ghost'}
                size="icon-sm"
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                disabled={disabled}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            ),
          )}
        </div>

        {/* Compact page indicator for small screens */}
        <span className="px-2 text-sm text-ink-600 sm:hidden" aria-live="polite">
          Page {page} of {totalPages}
        </span>

        <NavButton
          label="Next page"
          icon={<ChevronRight />}
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        />
        <NavButton
          label="Last page"
          icon={<ChevronsRight />}
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(totalPages)}
        />
      </nav>
    </div>
  );
}

export { Pagination };
