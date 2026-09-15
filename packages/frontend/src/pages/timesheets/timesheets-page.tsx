import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApprovalHistoryTimeline } from '@/components/timesheets/approval-history-timeline';
import { SubmitTimesheetDialog } from '@/components/timesheets/submit-timesheet-dialog';
import { WeekTimesheetEditor } from '@/components/timesheets/week-timesheet-editor';
import { PageHeader } from '@/components/layout/page-header';
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
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { projectRepo, timesheetEntryRepo, timesheetRepo } from '@/lib/timesheet-api';
import {
  addDays,
  canGoNextWeek,
  canGoPrevWeek,
  formatWeekLabel,
  timesheetStatusConfig,
  todayISO,
} from '@/lib/timesheet-utils';
import type { WeekCellChange } from '@/lib/timesheet-week';
import { cn } from '@/lib/utils';
import type { Project, TimesheetDetail } from '@/types/timesheet';

const WEEK_WINDOW_NOTICE =
  'Only the current and previous week are available — timesheets for older weeks cannot be viewed or edited.';

/**
 * Own timesheet page.
 *
 * Data loading, the week selection, saving, and submission live here; the
 * whole-week grid itself is delegated to {@link WeekTimesheetEditor}, which
 * holds the in-progress draft for a single screen session.
 */
export function TimesheetsPage() {
  const { showToast, toastElement } = useToast();

  const [anchorDate, setAnchorDate] = useState(todayISO());
  const [timesheet, setTimesheet] = useState<TimesheetDetail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  /** Monday-of-week that the currently rendered timesheet was loaded for. */
  const [loadedAnchor, setLoadedAnchor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Bumped on every successful write so the editor re-seeds from the server. */
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Target week offset awaiting confirmation of unsaved grid edits. */
  const [pendingNav, setPendingNav] = useState<number | null>(null);

  // Derived loading flag: in flight while the selected week has not been
  // resolved yet (avoids a synchronous setState inside the effect below).
  const loading = loadedAnchor !== anchorDate;

  // The editor reports its dirty state here (via a ref, so switching weeks is
  // the only thing that ever re-renders because of it).
  const dirtyRef = useRef(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  // Load the (get-or-create) timesheet for the selected week. The server only
  // allows the current or previous week; a 400 past that window is surfaced as
  // a friendly notice rather than an error.
  useEffect(() => {
    let cancelled = false;
    timesheetRepo
      .getCurrent(anchorDate)
      .then((detail) => {
        if (cancelled) return;
        setTimesheet(detail);
        setNotice(null);
        setLoadError(null);
        setLoadedAnchor(anchorDate);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadedAnchor(anchorDate);
        setLoadError(null);
        if (err instanceof ApiError && err.status === 400) {
          setNotice(WEEK_WINDOW_NOTICE);
          setTimesheet(null);
        } else {
          setLoadError(err instanceof Error ? err.message : 'Failed to load the timesheet.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [anchorDate]);

  // Active project catalog for the "add project row" control.
  useEffect(() => {
    let cancelled = false;
    projectRepo
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const editable =
    timesheet !== null && (timesheet.status === 'DRAFT' || timesheet.status === 'REJECTED');
  const status = timesheet?.status ?? 'DRAFT';
  const weekLabel = formatWeekLabel(timesheet?.periodStart ?? anchorDate);

  // Latest rejection decision — drives the "action required" banner.
  const latestRejection = useMemo(() => {
    if (!timesheet) return null;
    const rejects = timesheet.approvals.filter((approval) => approval.action === 'REJECT');
    return rejects.length > 0 ? (rejects[rejects.length - 1] ?? null) : null;
  }, [timesheet]);

  const showTimeline = Boolean(
    timesheet && (timesheet.submittedAt || timesheet.approvals.length > 0),
  );

  // The editor is remounted (and therefore re-seeded) after every write and
  // whenever the selected week changes.
  const editorKey = `${timesheet?.id ?? 'none'}:${timesheet?.updatedAt ?? ''}:${revision}`;

  const goToWeek = useCallback((deltaDays: number) => {
    setTimesheet(null);
    setPendingNav(null);
    setAnchorDate((current) => addDays(current, deltaDays));
  }, []);

  const requestNav = useCallback(
    (deltaDays: number) => {
      if (dirtyRef.current) {
        setPendingNav(deltaDays);
        return;
      }
      goToWeek(deltaDays);
    },
    [goToWeek],
  );

  // ── Saving ───────────────────────────────────────────────────────────────

  const handleSaveWeek = useCallback(
    async (changes: WeekCellChange[]) => {
      setSaving(true);
      try {
        const updated = await timesheetEntryRepo.applyWeekChanges(
          changes.map((change) => ({
            projectId: change.projectId,
            taskId: change.taskId,
            entryDate: change.date,
            hours: change.hours,
            entryIds: change.entryIds,
          })),
        );
        setTimesheet(updated);
        setRevision((value) => value + 1);
        showToast(
          'success',
          changes.length === 1 ? 'Entry saved.' : `Saved ${changes.length} cells.`,
        );
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to save the week.');
        // A partially applied batch must not be trusted — reload the week.
        try {
          setTimesheet(await timesheetRepo.getCurrent(anchorDate));
          setRevision((value) => value + 1);
        } catch {
          // Keep the draft so the user can retry.
        }
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [anchorDate, showToast],
  );

  const handleSubmitConfirm = useCallback(async () => {
    if (!timesheet) return;
    setSubmitting(true);
    try {
      setTimesheet(await timesheetRepo.submit(timesheet.id));
      setRevision((value) => value + 1);
      setSubmitDialogOpen(false);
      showToast('success', 'Timesheet submitted for approval.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to submit the timesheet.');
    } finally {
      setSubmitting(false);
    }
  }, [timesheet, showToast]);

  return (
    <div>
      {toastElement}
      <PageHeader
        title="Timesheets"
        description="Fill in the whole week at once — hours per project, day by day — then save and submit for approval."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('gap-1.5', timesheetStatusConfig[status].badge)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', timesheetStatusConfig[status].dot)} />
              {timesheetStatusConfig[status].label}
            </Badge>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous week"
                title="Previous week"
                disabled={!canGoPrevWeek(anchorDate)}
                onClick={() => requestNav(-7)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-1.5">
                <CalendarRange className="h-4 w-4 text-ink-500" />
                <span className="font-mono text-sm font-medium text-ink-800">{weekLabel}</span>
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next week"
                title="Next week"
                disabled={!canGoNextWeek(anchorDate)}
                onClick={() => requestNav(7)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          {notice && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              {notice}
            </div>
          )}

          {latestRejection && editable && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Rejected by {latestRejection.approverEmail}
              </p>
              {latestRejection.comment && (
                <p className="mt-1 text-amber-700">“{latestRejection.comment}”</p>
              )}
              <p className="mt-1 text-xs text-amber-600">
                Your entries are unlocked — adjust them and resubmit for approval.
              </p>
            </div>
          )}

          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-ink-500">
              Loading timesheet…
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
            </div>
          ) : !timesheet ? (
            <p className="py-6 text-center text-sm text-ink-500">
              Select a week to view or log your hours.
            </p>
          ) : (
            <WeekTimesheetEditor
              key={editorKey}
              timesheet={timesheet}
              projects={projects}
              editable={editable}
              saving={saving}
              onSave={handleSaveWeek}
              onSubmit={() => setSubmitDialogOpen(true)}
              onDirtyChange={handleDirtyChange}
            />
          )}
        </CardContent>
      </Card>

      {showTimeline && timesheet && (
        <Card className="mt-6">
          <CardContent>
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-ink-500 uppercase">
              Approval history
            </h2>
            <ApprovalHistoryTimeline
              submittedAt={timesheet.submittedAt}
              approvals={timesheet.approvals}
            />
          </CardContent>
        </Card>
      )}

      {timesheet && (
        <SubmitTimesheetDialog
          open={submitDialogOpen}
          onOpenChange={setSubmitDialogOpen}
          timesheet={timesheet}
          submitting={submitting}
          onConfirm={handleSubmitConfirm}
        />
      )}

      {/* Unsaved-changes guard for the week navigator */}
      <Dialog open={pendingNav !== null} onOpenChange={(open) => !open && setPendingNav(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Switching week will discard the hours you typed but did not save.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingNav(null)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => goToWeek(pendingNav ?? 0)}>
              Discard and switch week
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
