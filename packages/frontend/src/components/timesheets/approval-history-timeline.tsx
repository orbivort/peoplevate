import { CheckCircle2, Send, XCircle } from 'lucide-react';
import { memo, useMemo, type ReactNode } from 'react';

import { cn, formatDateTime } from '@/lib/utils';
import type { TimesheetApproval } from '@/types/timesheet';

interface TimelineNodeProps {
  icon: ReactNode;
  iconClass: string;
  title: string;
  meta: string;
  comment: string | null;
  highlightComment?: boolean;
  last?: boolean;
}

const TimelineNode = memo(function TimelineNode({
  icon,
  iconClass,
  title,
  meta,
  comment,
  highlightComment = false,
  last = false,
}: TimelineNodeProps) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute top-7 left-[13px] h-full w-px bg-ink-200" aria-hidden />}
      <span
        className={cn(
          'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          iconClass,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="text-xs text-ink-500">{meta}</p>
        {comment && (
          <p
            className={cn(
              'mt-1.5 rounded-lg border p-2.5 text-sm',
              highlightComment
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-ink-100 bg-ink-50/60 text-ink-700',
            )}
          >
            “{comment}”
          </p>
        )}
      </div>
    </li>
  );
});

export interface ApprovalHistoryTimelineProps {
  submittedAt: string | null;
  approvals: TimesheetApproval[];
  className?: string;
}

/**
 * Vertical timeline of the timesheet's approval history: the submission node
 * followed by each approve/reject decision. Rejection comments are
 * highlighted in amber.
 */
export function ApprovalHistoryTimeline({
  submittedAt,
  approvals,
  className,
}: ApprovalHistoryTimelineProps) {
  const decisions = useMemo(() => [...approvals].reverse(), [approvals]);
  return (
    <div className={className} data-slot="approval-history-timeline">
      <ul className="relative">
        {submittedAt && (
          <TimelineNode
            icon={<Send className="h-3.5 w-3.5" />}
            iconClass="bg-blue-100 text-blue-700"
            title="Submitted for approval"
            meta={formatDateTime(submittedAt)}
            comment={null}
          />
        )}
        {decisions.map((approval, index) => {
          const rejected = approval.action === 'REJECT';
          return (
            <TimelineNode
              key={approval.id}
              icon={
                rejected ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )
              }
              iconClass={rejected ? 'bg-red-100 text-red-600' : 'bg-accent-100 text-accent-700'}
              title={rejected ? 'Rejected' : 'Approved'}
              meta={`${approval.approverEmail} · ${formatDateTime(approval.createdAt)}`}
              comment={approval.comment}
              highlightComment={rejected}
              last={index === decisions.length - 1}
            />
          );
        })}
      </ul>
    </div>
  );
}
