import { motion } from 'framer-motion';
import { AlertTriangle, FileClock, RefreshCw, Search, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useAuditLog } from '@/data/data-layer';
import type { AuditChange } from '@/types';
import { cn, formatDate, initials } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 25;
/** How often (ms) the list auto-refreshes to pick up newly written entries. */
const REFRESH_INTERVAL_MS = 30_000;

const actionColors: Record<string, string> = {
  CREATE: 'bg-accent-100 text-accent-800',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-ink-100 text-ink-700',
  LOGOUT: 'bg-ink-100 text-ink-700',
};

/** Entity filter options: value (lowercased) -> display label. */
const entityOptions: { value: string; label: string }[] = [
  { value: 'all', label: 'All entities' },
  { value: 'employees', label: 'Employees' },
  { value: 'departments', label: 'Departments' },
  { value: 'positions', label: 'Positions' },
  { value: 'users', label: 'Users' },
  { value: 'auth', label: 'Authentication' },
  { value: 'documents', label: 'Documents' },
];

/** Action filter options: value (uppercased enum) -> display label. */
const actionOptions: { value: string; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
];

/** Human-friendly field-name display (convert snake_case to words). */
function labelField(field: string): string {
  if (!field) return field;
  return field
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Render the "Change" summary for an entry as a compact list of field diffs. */
function ChangeSummary({ changes }: { changes?: AuditChange[] }) {
  const list = changes ?? [];
  if (list.length === 0) {
    return <span className="text-ink-400">—</span>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {list.slice(0, 6).map((c, i) => (
        <div key={`${c.field}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-ink-700">{labelField(c.label || c.field)}</span>
          {c.old !== null && c.new !== null ? (
            <>
              <span className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-500 line-through">
                {c.old}
              </span>
              <span aria-hidden="true" className="text-ink-400">
                →
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5',
                  c.sensitive ? 'bg-ink-100 text-ink-400' : 'bg-accent-100 text-accent-800',
                )}
              >
                {c.new}
              </span>
            </>
          ) : c.new !== null ? (
            <span className="rounded bg-accent-100 px-1.5 py-0.5 text-accent-800">
              {c.sensitive ? '[redacted]' : c.new}
            </span>
          ) : (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 line-through">
              {c.sensitive ? '[redacted]' : c.old}
            </span>
          )}
        </div>
      ))}
      {list.length > 6 && (
        <span className="text-[10px] text-ink-400">+{list.length - 6} more fields</span>
      )}
    </div>
  );
}

/** Skeleton table rows shown while the next page is loading. */
function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="border-b border-ink-200">
          <TableCell className="p-4">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-7 w-7 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-14 rounded-full" />
          </TableCell>
          <TableCell>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </TableCell>
          <TableCell>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
        </tr>
      ))}
    </>
  );
}

/** Table column headers shared by the loading and populated tables. */
const TABLE_HEADERS = (
  <>
    <TableHead className="w-[200px]">User</TableHead>
    <TableHead className="w-[100px]">Action</TableHead>
    <TableHead className="w-[140px]">Resource</TableHead>
    <TableHead>Change</TableHead>
    <TableHead className="w-[110px]">Status</TableHead>
    <TableHead className="w-[180px]">Timestamp</TableHead>
  </>
);

export function AuditLogPage() {
  const { hasPermission } = useAuth();
  const isFullAudit = hasPermission('viewFullAuditLog');

  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Tracks the "committed" filters; the URL fetches only what has been applied.
  const [applied, setApplied] = useState<{
    from?: string | undefined;
    to?: string | undefined;
    user?: string | undefined;
  }>({});

  const { data, loading, error, reload } = useAuditLog({
    action: actionFilter,
    entity: entityFilter,
    search,
    from: applied.from,
    to: applied.to,
    user: applied.user,
    page,
    pageSize,
    // Mirror the backend HR-scope restriction in mock/fallback mode.
    hrScoped: !isFullAudit,
  });

  const logs = data.logs;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Keep the latest reload callback in a ref so the polling interval is created
  // exactly once and always calls the current fetch function.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // Auto-refresh: poll the latest page on an interval so newly written audit
  // entries appear without a manual reload. Cleaned up on unmount.
  useEffect(() => {
    const id = setInterval(() => reloadRef.current(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Reset to the first page whenever a filter or the page size changes so the
  // user is never stranded on an out-of-range page.
  const resetToFirstPage = useCallback(() => {
    setPage(1);
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    resetToFirstPage();
  };
  const handleUserChange = (value: string) => {
    setUserFilter(value);
    setApplied((prev) => ({ ...prev, user: value || undefined }));
    resetToFirstPage();
  };
  const handleFromDateChange = (value: string) => {
    setFromDate(value);
    setApplied((prev) => ({ ...prev, from: value || undefined }));
    resetToFirstPage();
  };
  const handleToDateChange = (value: string) => {
    setToDate(value);
    setApplied((prev) => ({ ...prev, to: value || undefined }));
    resetToFirstPage();
  };
  const handleActionChange = (value: string) => {
    setActionFilter(value);
    resetToFirstPage();
  };
  const handleEntityChange = (value: string) => {
    setEntityFilter(value);
    resetToFirstPage();
  };
  const handlePageSizeChange = (value: number) => {
    setPageSize(value);
    resetToFirstPage();
  };

  const hasActiveDateOrUserFilter =
    applied.user !== undefined || applied.from !== undefined || applied.to !== undefined;

  return (
    <div>
      <PageHeader
        title="Audit log"
        description={
          isFullAudit
            ? 'Immutable record of all create, update, and delete operations on protected entities.'
            : 'Audit trail for employee and document changes (HR-scoped view).'
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loading}
            aria-label="Refresh audit log"
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              placeholder="Search entity, values…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="relative flex-1 sm:max-w-xs">
            <User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              placeholder="Filter by user (name or ID)"
              value={userFilter}
              onChange={(e) => handleUserChange(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-ink-400 sm:inline">Date</span>
            <Input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={(e) => handleFromDateChange(e.target.value)}
              className="w-full sm:w-40"
            />
            <span className="text-ink-400">–</span>
            <Input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={(e) => handleToDateChange(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <Select value={actionFilter} onValueChange={handleActionChange}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              {actionOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={handleEntityChange}>
            <SelectTrigger className="sm:w-44">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              {entityOptions.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-sm text-ink-500" aria-live="polite">
            {total} {total === 1 ? 'entry' : 'entries'}
          </div>
        </div>
        {hasActiveDateOrUserFilter && (
          <div className="mt-3 border-t border-ink-100 pt-2 text-xs text-ink-400">
            Filters applied automatically as you type — the table below reflects them.
          </div>
        )}
      </Card>

      <Card>
        {error && !loading ? (
          <EmptyState
            icon={AlertTriangle}
            title="Unable to load audit log"
            description={error}
            action={
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            }
          />
        ) : loading ? (
          <Table>
            <TableHeader>
              <TableRow>{TABLE_HEADERS}</TableRow>
            </TableHeader>
            <TableBody>
              <SkeletonRows count={pageSize > 10 ? 10 : pageSize} />
            </TableBody>
          </Table>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={FileClock}
            title="No audit entries"
            description="No entries match your current filters."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>{TABLE_HEADERS}</TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((entry, i) => (
                <motion.tr
                  key={entry.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                  className="group border-b border-ink-200 transition-colors hover:bg-ink-50/60"
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="bg-ink-100 text-[10px] text-ink-600">
                          {entry.actorName ? initials(entry.actorName) : 'S'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium text-ink-900">
                          {entry.actorName || 'System'}
                        </div>
                        {entry.actorId && (
                          <div className="font-mono text-[10px] text-ink-400">{entry.actorId}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        'border-transparent font-mono text-[10px]',
                        actionColors[entry.action] ?? 'bg-ink-100 text-ink-700',
                      )}
                    >
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="text-sm text-ink-700">
                        {entry.entityLabel || entry.entity}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400">{entry.entityId}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ChangeSummary changes={entry.changes} />
                  </TableCell>
                  <TableCell>
                    <Badge className="border-transparent bg-accent-100 font-mono text-[10px] text-accent-800">
                      {entry.status || 'Success'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-ink-600">
                      {formatDate(entry.timestamp, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        )}

        {!loading && !error && logs.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            disabled={loading}
          />
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <FileClock className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <p>
          Audit entries are written by PostgreSQL triggers on every INSERT, UPDATE, and DELETE to
          protected tables — even when application logic is bypassed. The list refreshes
          automatically every 30 seconds. The{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 font-mono">audit_log</code> table is
          immutable: UPDATE and DELETE are rejected by a database rule.
        </p>
      </div>
    </div>
  );
}
