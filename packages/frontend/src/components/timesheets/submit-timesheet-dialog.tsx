import { AlertTriangle, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatHours, formatWeekLabel, weekdayDatesWithZeroHours } from '@/lib/timesheet-utils';
import type { TimesheetDetail } from '@/types/timesheet';

export interface SubmitTimesheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timesheet: TimesheetDetail;
  submitting: boolean;
  onConfirm: () => void;
}

/**
 * Submission confirmation with the weekly total, per-project recap, and
 * non-blocking warnings for working days that have no logged hours.
 */
export function SubmitTimesheetDialog({
  open,
  onOpenChange,
  timesheet,
  submitting,
  onConfirm,
}: SubmitTimesheetDialogProps) {
  const zeroHourDays = weekdayDatesWithZeroHours(timesheet.periodStart, timesheet.perDayTotals);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit timesheet for approval</DialogTitle>
          <DialogDescription>
            Week of {formatWeekLabel(timesheet.periodStart)}. Once submitted, entries are locked
            until your manager responds.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between rounded-lg border border-ink-200 bg-ink-50/60 px-4 py-3">
            <span className="text-sm font-medium text-ink-700">Weekly total</span>
            <span className="font-mono text-lg font-bold text-ink-900">
              {formatHours(timesheet.weeklyTotalHours)}h
            </span>
          </div>

          {timesheet.perProjectTotals.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                Per-project recap
              </p>
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {timesheet.perProjectTotals.map((project) => (
                  <li
                    key={project.projectId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge className="border-transparent bg-ink-900 px-1.5 font-mono text-[10px] text-ink-50">
                        {project.projectCode}
                      </Badge>
                      <span className="truncate text-ink-700">{project.projectName}</span>
                    </span>
                    <span className="font-mono font-medium text-ink-700">
                      {formatHours(project.hours)}h
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {zeroHourDays.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Working days without logged hours</p>
                <p className="mt-0.5 text-amber-700">
                  {zeroHourDays.join(', ')} — you can still submit if you did not work those days.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" onClick={onConfirm} disabled={submitting}>
            <Send className="h-4 w-4" />
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
