import { CheckCircle2, ChevronDown, ChevronUp, Clock, RefreshCw, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { ApprovalHistoryTimeline } from '@/components/timesheets/approval-history-timeline';
import { WeekReviewLedger } from '@/components/timesheets/week-review-ledger';
import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { timesheetRepo } from '@/lib/timesheet-api';
import {
  formatHours,
  formatWeekLabel,
  timesheetStatusConfig,
} from '@/lib/timesheet-utils';
import { cn, formatDateTime, formatRelative, initials } from '@/lib/utils';
import type { TimesheetDetail, TimesheetSummary } from '@/types/timesheet';

/** Anchors the reject error banner to the field it refers to. */
const REJECT_ERROR_ID = 'reject-comment-error';

/** Compact headline figure, matching the ledger summary typography. */
function QueueStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">{label}</p>
      <p className="font-mono text-lg leading-tight font-semibold tabular-nums text-ink-900">
        {value}
      </p>
    </div>
  );
}

function employeeName(row: TimesheetSummary): string {
  return `${row.employee.firstName} ${row.employee.lastName}`;
}

/**
 * Manager approval queue.
 *
 * The queue rows stay compact, while the expanded review reuses the employee's
 * week ledger in read-only form (see `week-review-ledger.tsx`) so both sides of
 * the workflow look at the same Mon–Sun shape.
 */
export function TimesheetApprovalsPage() {
  const { showToast, toastElement } = useToast();

  const [queue, setQueue] = useState<TimesheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TimesheetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const [rejecting, setRejecting] = useState<TimesheetSummary | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  // The initial load is defined inside the effect (cancelled-guarded) so no
  // setState can run synchronously during the effect; `refresh` re-uses the
  // same logic for the manual refresh button.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const pending = await timesheetRepo.getPending();
        if (!cancelled) {
          setQueue(pending);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load the approval queue.');
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const pending = await timesheetRepo.getPending();
      setQueue(pending);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the approval queue.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  const toggleExpanded = useCallback(
    (row: TimesheetSummary) => {
      setComment('');
      if (expandedId === row.id) {
        setExpandedId(null);
        setDetail(null);
        return;
      }
      setExpandedId(row.id);
      setDetail(null);
      setDetailLoading(true);
      timesheetRepo
        .getById(row.id)
        .then(setDetail)
        .catch((err) =>
          showToast('error', err instanceof Error ? err.message : 'Failed to load the timesheet.'),
        )
        .finally(() => setDetailLoading(false));
    },
    [expandedId, showToast],
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      setQueue((prev) => prev.filter((t) => t.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (expandedId === id) {
        setExpandedId(null);
        setDetail(null);
      }
    },
    [expandedId],
  );

  const handleApprove = useCallback(
    async (row: TimesheetSummary, approveComment?: string) => {
      setActionBusy(true);
      try {
        const trimmed = approveComment?.trim();
        await timesheetRepo.approve(row.id, trimmed || undefined);
        showToast('success', `Approved ${employeeName(row)}'s timesheet.`);
        removeFromQueue(row.id);
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to approve the timesheet.');
      } finally {
        setActionBusy(false);
      }
    },
    [removeFromQueue, showToast],
  );

  const handleRejectConfirm = useCallback(async () => {
    if (!rejecting) return;
    const trimmed = rejectComment.trim();
    if (!trimmed) {
      setRejectError('A comment is required when rejecting a timesheet.');
      return;
    }
    if (trimmed.length > 500) {
      setRejectError('The comment cannot exceed 500 characters.');
      return;
    }
    setActionBusy(true);
    try {
      await timesheetRepo.reject(rejecting.id, trimmed);
      showToast('success', `Rejected ${employeeName(rejecting)}'s timesheet.`);
      removeFromQueue(rejecting.id);
      setRejecting(null);
      setRejectComment('');
      setRejectError(null);
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Failed to reject the timesheet.');
    } finally {
      setActionBusy(false);
    }
  }, [rejecting, rejectComment, removeFromQueue, showToast]);

  const handleBatchApprove = useCallback(async () => {
    setBatchBusy(true);
    const results = await Promise.allSettled(
      [...selected].map((id) => timesheetRepo.approve(id, undefined)),
    );
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures === 0) {
      showToast('success', `Approved ${selected.size} timesheets.`);
    } else {
      showToast('error', `Approved ${selected.size - failures} of ${selected.size} timesheets.`);
    }
    setSelected(new Set());
    setBatchBusy(false);
    void refresh();
  }, [selected, refresh, showToast]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Queue headline figures, mirroring the week summary shown while reviewing.
  const queueHours = useMemo(
    () => queue.reduce((sum, row) => sum + row.weeklyTotalHours, 0),
    [queue],
  );
  const oldestWaiting = useMemo(() => {
    const submitted = queue
      .map((row) => row.submittedAt)
      .filter((value): value is string => value !== null)
      .sort();
    return submitted[0] ?? null;
  }, [queue]);

  return (
    <div>
      {toastElement}
      <PageHeader
        title="Timesheet approvals"
        description="Review submitted weekly timesheets from your team and approve or reject them."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                void refresh();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => void handleBatchApprove()}
              disabled={selected.size === 0 || batchBusy}
            >
              <CheckCircle2 className="h-4 w-4" />
              {batchBusy ? 'Approving…' : `Approve selected (${selected.size})`}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-ink-500">
              Loading approval queue…
            </div>
          ) : loadError ? (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All caught up"
              description="No submitted timesheets are waiting for your decision."
            />
          ) : (
            <>
              <div
                className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-100 bg-ink-50/50 px-4 py-3"
                data-slot="queue-summary"
              >
                <QueueStat label="Awaiting review" value={String(queue.length)} />
                <QueueStat label="Hours in queue" value={`${formatHours(queueHours)}h`} />
                <QueueStat
                  label="Oldest waiting"
                  value={oldestWaiting ? formatRelative(oldestWaiting) : '—'}
                />
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">Select</span>
                    </TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead>Logged</TableHead>
                    <TableHead>Submitted at</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-right">
                      <span className="sr-only">Review</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map((row) => {
                    const expanded = expandedId === row.id;
                    return (
                      <Fragment key={row.id}>
                        <TableRow className={cn(expanded && 'bg-ink-50/60')}>
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`Select ${employeeName(row)}'s timesheet`}
                              checked={selected.has(row.id)}
                              onChange={() => toggleSelected(row.id)}
                              className="h-4 w-4 cursor-pointer rounded border-ink-300 accent-ink-900"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-9 w-9">
                                <AvatarFallback className="bg-ink-900 text-[11px] text-ink-50">
                                  {initials(employeeName(row))}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="truncate font-medium text-ink-900">
                                  {employeeName(row)}
                                </div>
                                <div className="font-mono text-[11px] text-ink-400">
                                  {row.employee.employeeNo}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-ink-600">
                            {formatWeekLabel(row.periodStart)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-ink-300" />
                              <span className="font-mono text-sm font-semibold tabular-nums text-ink-900">
                                {formatHours(row.weeklyTotalHours)}h
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-ink-400">
                              {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm text-ink-500">
                            {row.submittedAt ? (
                              <span title={formatDateTime(row.submittedAt)}>
                                {formatRelative(row.submittedAt)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={cn('gap-1.5', timesheetStatusConfig[row.status].badge)}
                            >
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  timesheetStatusConfig[row.status].dot,
                                )}
                              />
                              {timesheetStatusConfig[row.status].label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant={expanded ? 'subtle' : 'outline'}
                              size="sm"
                              aria-label={expanded ? 'Collapse review' : 'Review timesheet'}
                              onClick={() => toggleExpanded(row)}
                            >
                              {expanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                              <span className="hidden sm:inline">{expanded ? 'Close' : 'Review'}</span>
                            </Button>
                          </TableCell>
                        </TableRow>

                        {expanded && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={7} className="bg-ink-50/40 p-0">
                              {detailLoading ? (
                                <div className="flex h-24 items-center justify-center text-sm text-ink-500">
                                  Loading timesheet…
                                </div>
                              ) : detail ? (
                                <div className="space-y-5 p-4 sm:p-5" data-slot="review-panel">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
                                        Reviewing
                                      </p>
                                      <p className="font-display text-xl font-semibold text-ink-900">
                                        {employeeName(row)} · {formatWeekLabel(detail.periodStart)}
                                      </p>
                                    </div>
                                    <Badge
                                      className={cn(
                                        'gap-1.5',
                                        timesheetStatusConfig[detail.status].badge,
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'h-1.5 w-1.5 rounded-full',
                                          timesheetStatusConfig[detail.status].dot,
                                        )}
                                      />
                                      {timesheetStatusConfig[detail.status].label}
                                    </Badge>
                                  </div>

                                  <WeekReviewLedger timesheet={detail} />

                                  <div className="grid gap-6 lg:grid-cols-2">
                                    <div className="rounded-xl border border-ink-200 bg-white p-4">
                                      <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                                        Approval history
                                      </h3>
                                      <ApprovalHistoryTimeline
                                        submittedAt={detail.submittedAt}
                                        approvals={detail.approvals}
                                      />
                                    </div>

                                    <aside className="space-y-3 rounded-xl border border-ink-200 bg-white p-4">
                                      <div>
                                        <h3 className="text-sm font-semibold text-ink-900">
                                          Your decision
                                        </h3>
                                        <p className="mt-0.5 text-xs text-ink-500">
                                          Approving locks the week. Rejecting unlocks it so the
                                          employee can correct it and resubmit.
                                        </p>
                                      </div>
                                      <div className="space-y-1.5">
                                        <Label htmlFor="approval-comment">
                                          Comment (optional for approval, required to reject)
                                        </Label>
                                        <Input
                                          id="approval-comment"
                                          maxLength={500}
                                          placeholder="Add context to your decision…"
                                          value={comment}
                                          onChange={(e) => setComment(e.target.value)}
                                        />
                                        <p className="text-xs text-ink-400">
                                          Shown to the employee, and carried into the reject dialog.
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          variant="accent"
                                          size="sm"
                                          disabled={actionBusy}
                                          onClick={() => void handleApprove(row, comment)}
                                        >
                                          <CheckCircle2 className="h-4 w-4" />
                                          Approve
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="gap-1 text-red-600 hover:bg-red-50"
                                          disabled={actionBusy}
                                          onClick={() => {
                                            setRejecting(row);
                                            // Carry over the panel comment so a rejection reason
                                            // typed above never has to be entered twice.
                                            setRejectComment(comment);
                                            setRejectError(null);
                                          }}
                                        >
                                          <X className="h-4 w-4" />
                                          Reject
                                        </Button>
                                      </div>
                                    </aside>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-6 text-sm text-ink-400">
                                  Could not load the timesheet detail.
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Reject dialog — comment mandatory */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject timesheet</DialogTitle>
            <DialogDescription>
              {rejecting &&
                `${employeeName(rejecting)} will be able to edit and resubmit the week of ${formatWeekLabel(rejecting.periodStart)}.`}
            </DialogDescription>
          </DialogHeader>
          {rejectError && (
            <div
              id={REJECT_ERROR_ID}
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {rejectError}
            </div>
          )}
          <div className="space-y-1.5 py-1">
            <Label htmlFor="reject-comment">Comment *</Label>
            <Textarea
              id="reject-comment"
              rows={3}
              maxLength={500}
              aria-invalid={rejectError ? true : undefined}
              aria-describedby={rejectError ? REJECT_ERROR_ID : undefined}
              value={rejectComment}
              placeholder="Explain what needs to be corrected…"
              onChange={(e) => {
                setRejectComment(e.target.value);
                if (rejectError) setRejectError(null);
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleRejectConfirm()}
              disabled={actionBusy}
            >
              {actionBusy ? 'Rejecting…' : 'Reject timesheet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
