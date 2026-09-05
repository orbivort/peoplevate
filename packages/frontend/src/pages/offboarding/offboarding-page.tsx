import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Calendar,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileSignature,
  FileText,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  Receipt,
  ShieldAlert,
  Sparkles,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { useEmployees } from '@/data/data-layer';
import { offboardingRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate, initials } from '@/lib/utils';
import type {
  ClearanceCategory,
  ClearanceItem,
  ExitInterview,
  FinalSettlement,
  OffboardingRecord,
  OffboardingStatus,
  SeparationType,
} from '@/types';

const statusConfig: Record<OffboardingStatus, { dot: string; badge: string; label: string }> = {
  Initiated: {
    dot: 'bg-blue-500',
    badge: 'border-transparent bg-blue-100 text-blue-700',
    label: 'Initiated',
  },
  'Clearance In Progress': {
    dot: 'bg-amber-500',
    badge: 'border-transparent bg-amber-100 text-amber-800',
    label: 'Clearance',
  },
  'Exit Interview': {
    dot: 'bg-purple-500',
    badge: 'border-transparent bg-purple-100 text-purple-700',
    label: 'Exit Interview',
  },
  Settlement: {
    dot: 'bg-accent-500',
    badge: 'border-transparent bg-accent-100 text-accent-800',
    label: 'Settlement',
  },
  Closed: {
    dot: 'bg-ink-400',
    badge: 'border-transparent bg-ink-100 text-ink-600',
    label: 'Closed',
  },
};

const separationColors: Record<SeparationType, string> = {
  Resignation: 'bg-blue-100 text-blue-700',
  Dismissal: 'bg-red-100 text-red-700',
  'End of Contract': 'bg-amber-100 text-amber-800',
};

const categoryIcons: Record<ClearanceCategory, typeof Laptop> = {
  'Asset Return': Laptop,
  'Access Revocation': KeyRound,
  'Knowledge Transfer': MessageSquare,
  'Final Settlement': Receipt,
};

const pipelineStages: OffboardingStatus[] = [
  'Initiated',
  'Clearance In Progress',
  'Exit Interview',
  'Settlement',
  'Closed',
];

interface OffForm {
  employeeId: string;
  separationType: SeparationType;
  reason: string;
  lastWorkingDay: string;
  deactivationDate: string;
}

export function OffboardingPage() {
  const { hasPermission, employee } = useAuth();
  const isHrOrAdmin = hasPermission('manageOffboarding');
  const isEmployeeView = hasPermission('viewOwnOffboarding') && !isHrOrAdmin;

  const { data: employees } = useEmployees();
  const [records, setRecords] = useState<OffboardingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [waiveDialogFor, setWaiveDialogFor] = useState<{
    recordId: string;
    itemId: string;
  } | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [form, setForm] = useState<OffForm>({
    employeeId: '',
    separationType: 'Resignation',
    reason: '',
    lastWorkingDay: '',
    deactivationDate: '',
  });
  const [error, setError] = useState<string | null>(null);

  // Self-service resignation dialog state (Employee/Manager only)
  const [resignOpen, setResignOpen] = useState(false);
  const [selfForm, setSelfForm] = useState({
    reason: '',
    lastWorkingDay: '',
    deactivationDate: '',
    acknowledged: false,
  });
  const [selfError, setSelfError] = useState<string | null>(null);

  const eligibleEmployees = employees.filter((e) => e.status !== 'Terminated');

  const load = useCallback(async () => {
    try {
      const list = await offboardingRepo.list();
      const withClearance = await Promise.all(
        list.map(async (rec) => {
          try {
            const items = await offboardingRepo.listClearance(rec.id);
            return { ...rec, clearanceItems: items };
          } catch {
            return { ...rec, clearanceItems: rec.clearanceItems ?? [] };
          }
        }),
      );
      setRecords(withClearance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load offboarding records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const activeRecord = records.find((r) => r.id === activeId) ?? null;

  // For employees, filter to only their own records
  const visibleRecords = useMemo(() => {
    if (isEmployeeView && employee) {
      return records.filter((r) => r.employeeId === employee.id);
    }
    return records;
  }, [records, isEmployeeView, employee]);

  const stats = useMemo(() => {
    const pool = visibleRecords;
    const inProgress = pool.filter((r) => r.status !== 'Closed').length;
    const closed = pool.filter((r) => r.status === 'Closed').length;
    const pendingClearance = pool
      .filter((r) => r.status !== 'Closed')
      .flatMap((r) => r.clearanceItems)
      .filter((ci) => ci.status === 'Pending').length;
    return { inProgress, closed, pendingClearance };
  }, [visibleRecords]);

  const toggleClearance = async (recordId: string, itemId: string) => {
    const rec = records.find((r) => r.id === recordId);
    const item = rec?.clearanceItems.find((ci) => ci.id === itemId);
    if (!rec || !item) return;
    const nextStatus = item.status === 'Complete' ? 'PENDING' : 'COMPLETE';
    try {
      await offboardingRepo.updateClearanceItem(itemId, { status: nextStatus });
      setRecords((prev) =>
        prev.map((rec) => {
          if (rec.id !== recordId) return rec;
          const updatedItems = rec.clearanceItems.map((ci) => {
            if (ci.id !== itemId) return ci;
            const isComplete = ci.status === 'Complete';
            return {
              ...ci,
              status: (isComplete ? 'Pending' : 'Complete') as ClearanceItem['status'],
              completedAt: isComplete ? null : new Date().toISOString(),
              signOffBy: isComplete ? undefined : 'Emily Doe',
            } as ClearanceItem;
          });
          return { ...rec, clearanceItems: updatedItems };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update clearance item.');
    }
  };

  const handleWaive = async () => {
    if (!waiveDialogFor) return;
    try {
      await offboardingRepo.updateClearanceItem(waiveDialogFor.itemId, {
        status: 'WAIVED',
        waivedReason: waiveReason,
      });
      setRecords((prev) =>
        prev.map((rec) => {
          if (rec.id !== waiveDialogFor.recordId) return rec;
          const updatedItems = rec.clearanceItems.map((ci) =>
            ci.id === waiveDialogFor.itemId
              ? {
                  ...ci,
                  status: 'Waived' as const,
                  waivedReason: waiveReason,
                  completedAt: new Date().toISOString(),
                }
              : ci,
          );
          return { ...rec, clearanceItems: updatedItems };
        }),
      );
      setWaiveDialogFor(null);
      setWaiveReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to waive clearance item.');
    }
  };

  const advanceStatus = async (record: OffboardingRecord) => {
    const allClear = record.clearanceItems.every(
      (ci) => ci.status === 'Complete' || ci.status === 'Waived',
    );
    if (record.status === 'Clearance In Progress' && !allClear) return;
    const idx = pipelineStages.indexOf(record.status);
    if (idx < 0 || idx >= pipelineStages.length - 1) return;
    try {
      if (record.status === 'Settlement') {
        // Only the final closure is persisted to the backend.
        await offboardingRepo.close(record.id);
      }
      const next = pipelineStages[idx + 1]!;
      setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, status: next } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance offboarding stage.');
    }
  };

  const handleCreate = async () => {
    setError(null);
    if (!form.employeeId) {
      setError('Select an employee to offboard.');
      return;
    }
    if (!form.lastWorkingDay) {
      setError('Last working day is required.');
      return;
    }
    if (!form.deactivationDate) {
      setError('Deactivation date is required.');
      return;
    }
    if (form.separationType === 'Dismissal' && !hasPermission('manageOffboarding')) {
      setError('Only HR can initiate dismissal.');
      return;
    }

    const emp = employees.find((e) => e.id === form.employeeId);
    if (!emp) {
      setError('Employee not found.');
      return;
    }

    const backendSeparationType: Record<SeparationType, string> = {
      Resignation: 'RESIGNATION',
      Dismissal: 'DISMISSAL',
      'End of Contract': 'END_OF_CONTRACT',
    };

    try {
      await offboardingRepo.initiateTermination({
        employeeId: emp.id,
        separationType: backendSeparationType[form.separationType],
        reason: form.reason || undefined,
        effectiveDate: form.lastWorkingDay,
      });
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate offboarding.');
    }
  };

  const handleSelfResign = async () => {
    setSelfError(null);
    if (!employee) {
      setSelfError('Unable to identify your employee record.');
      return;
    }
    if (!selfForm.reason.trim()) {
      setSelfError('Please provide a reason for your resignation.');
      return;
    }
    if (!selfForm.lastWorkingDay) {
      setSelfError('Please select your proposed last working day.');
      return;
    }
    if (!selfForm.deactivationDate) {
      setSelfError('Please select your deactivation date.');
      return;
    }
    if (!selfForm.acknowledged) {
      setSelfError(
        'Please confirm that you understand the implications of submitting this resignation.',
      );
      return;
    }

    try {
      await offboardingRepo.submitResignation({
        reason: selfForm.reason,
        lastWorkingDay: selfForm.lastWorkingDay,
      });
      setResignOpen(false);
      await load();
    } catch (err) {
      setSelfError(err instanceof Error ? err.message : 'Failed to submit resignation.');
    }
  };

  const saveExitInterview = async (recordId: string, interview: ExitInterview) => {
    try {
      await offboardingRepo.conductExitInterview(recordId, {
        responses: interview.responses,
        declined: interview.declined,
      });
      setRecords((prev) =>
        prev.map((r) => (r.id === recordId ? { ...r, exitInterview: interview } : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exit interview.');
    }
  };

  const saveSettlement = (recordId: string, settlement: FinalSettlement) => {
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, settlement } : r)));
  };

  if (activeRecord) {
    return (
      <OffboardingDetail
        record={activeRecord}
        isEmployeeView={isEmployeeView}
        onToggleClearance={(itemId) => toggleClearance(activeRecord.id, itemId)}
        onWaive={(itemId) => setWaiveDialogFor({ recordId: activeRecord.id, itemId })}
        onAdvance={() => advanceStatus(activeRecord)}
        onBack={() => setActiveId(null)}
        onSaveExitInterview={(interview) => saveExitInterview(activeRecord.id, interview)}
        onSaveSettlement={(settlement) => saveSettlement(activeRecord.id, settlement)}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Offboarding"
        description={
          isEmployeeView
            ? 'View your offboarding status, clearance checklist, and settlement details.'
            : 'Manage separation, clearance checklists, exit interviews, and final settlements.'
        }
        actions={
          <>
            {isEmployeeView && (
              <Button
                variant="danger"
                onClick={() => {
                  setSelfForm({
                    reason: '',
                    lastWorkingDay: '',
                    deactivationDate: '',
                    acknowledged: false,
                  });
                  setSelfError(null);
                  setResignOpen(true);
                }}
              >
                <LogOut className="h-4 w-4" />
                Submit resignation
              </Button>
            )}
            {isHrOrAdmin && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Initiate offboarding
              </Button>
            )}
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={UserMinus}
          label="In progress"
          value={stats.inProgress}
          tone="amber"
          delay={0}
        />
        <StatTile
          icon={ClipboardList}
          label="Pending clearance items"
          value={stats.pendingClearance}
          tone="amber"
          delay={0.05}
        />
        <StatTile
          icon={CheckCircle2}
          label="Closed"
          value={stats.closed}
          tone="accent"
          delay={0.1}
        />
      </div>

      {/* Records list */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{isEmployeeView ? 'My offboarding' : 'Offboarding records'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-ink-500">
              Loading offboarding records…
            </div>
          ) : visibleRecords.length === 0 ? (
            <EmptyState
              icon={UserMinus}
              title="No offboarding records"
              description={
                isEmployeeView
                  ? 'You have no active offboarding records. If you have submitted a resignation, it will appear here once processed by HR.'
                  : 'Initiate offboarding when an employee resigns or a contract ends.'
              }
            />
          ) : (
            <div className="divide-y divide-ink-100">
              {visibleRecords.map((rec, i) => {
                const cfg = statusConfig[rec.status];
                const complete = rec.clearanceItems.filter(
                  (ci) => ci.status === 'Complete' || ci.status === 'Waived',
                ).length;
                const total = rec.clearanceItems.length;
                return (
                  <motion.button
                    key={rec.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.25 }}
                    onClick={() => setActiveId(rec.id)}
                    className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-ink-50"
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-ink-900 text-xs text-ink-50">
                        {initials(rec.employeeName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink-900">{rec.employeeName}</span>
                        <Badge
                          className={cn(
                            'border-transparent text-[10px]',
                            separationColors[rec.separationType],
                          )}
                        >
                          {rec.separationType}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {rec.positionName} · Last day{' '}
                        {formatDate(rec.lastWorkingDay, { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="hidden items-center gap-3 sm:flex">
                      <div className="w-24">
                        <div className="mb-1 flex justify-between text-[10px] text-ink-500">
                          <span>Clearance</span>
                          <span>
                            {complete}/{total}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full rounded-full bg-accent-500"
                            style={{ width: `${(complete / total) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <Badge className={cn('gap-1.5', cfg.badge)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                      {cfg.label}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-ink-400" />
                  </motion.button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initiate offboarding</DialogTitle>
            <DialogDescription>
              This creates an offboarding record and auto-generates a clearance checklist.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Employee *</Label>
              <Select
                value={form.employeeId}
                onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName} — {e.positionName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Separation type</Label>
                <Select
                  value={form.separationType}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, separationType: v as SeparationType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Resignation">Resignation</SelectItem>
                    <SelectItem value="Dismissal">Dismissal</SelectItem>
                    <SelectItem value="End of Contract">End of Contract</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="off-last">Last working day *</Label>
                <Input
                  id="off-last"
                  type="date"
                  value={form.lastWorkingDay}
                  onChange={(e) => setForm((f) => ({ ...f, lastWorkingDay: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="off-deact">Deactivation date *</Label>
              <Input
                id="off-deact"
                type="date"
                value={form.deactivationDate}
                onChange={(e) => setForm((f) => ({ ...f, deactivationDate: e.target.value }))}
              />
              <p className="text-xs text-ink-400">
                System access is automatically revoked on this date.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="off-reason">Reason</Label>
              <Textarea
                id="off-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Brief reason for separation…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleCreate}>
              <LogOut className="h-4 w-4" />
              Initiate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Self-service resignation dialog (Employee/Manager) */}
      <Dialog open={resignOpen} onOpenChange={setResignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit resignation</DialogTitle>
            <DialogDescription>
              This will initiate your offboarding process. Your manager and HR will be notified
              automatically.
            </DialogDescription>
          </DialogHeader>
          {selfError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {selfError}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="self-reason">Reason for leaving *</Label>
              <Textarea
                id="self-reason"
                value={selfForm.reason}
                onChange={(e) => setSelfForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Please briefly explain your reason for resigning..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="self-lwd">Proposed last working day *</Label>
                <Input
                  id="self-lwd"
                  type="date"
                  value={selfForm.lastWorkingDay}
                  onChange={(e) => setSelfForm((f) => ({ ...f, lastWorkingDay: e.target.value }))}
                />
                <p className="text-xs text-ink-400">Standard notice period is 30 days.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="self-deact">Deactivation date *</Label>
                <Input
                  id="self-deact"
                  type="date"
                  value={selfForm.deactivationDate}
                  onChange={(e) => setSelfForm((f) => ({ ...f, deactivationDate: e.target.value }))}
                />
                <p className="text-xs text-ink-400">System access is revoked on this date.</p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <input
                type="checkbox"
                checked={selfForm.acknowledged}
                onChange={(e) => setSelfForm((f) => ({ ...f, acknowledged: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600"
              />
              <div>
                <p className="text-sm font-medium text-amber-800">I understand</p>
                <p className="text-xs text-amber-600">
                  Submitting this resignation will begin the offboarding process. Your system access
                  will be revoked on your deactivation date. This action cannot be undone without HR
                  intervention.
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResignOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleSelfResign}>
              <LogOut className="h-4 w-4" />
              Submit resignation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waive dialog */}
      <Dialog open={!!waiveDialogFor} onOpenChange={(open) => !open && setWaiveDialogFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Waive clearance item</DialogTitle>
            <DialogDescription>
              Waiving requires HR approval and an audit note explaining the reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="waive-reason">Reason for waiver *</Label>
            <Textarea
              id="waive-reason"
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              placeholder="e.g. Asset already returned informally; no formal sign-off needed."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiveDialogFor(null)}>
              Cancel
            </Button>
            <Button onClick={handleWaive} disabled={!waiveReason.trim()}>
              <ShieldAlert className="h-4 w-4" />
              Approve waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OffboardingDetail({
  record,
  isEmployeeView = false,
  onToggleClearance,
  onWaive,
  onAdvance,
  onBack,
  onSaveExitInterview,
  onSaveSettlement,
}: {
  record: OffboardingRecord;
  isEmployeeView?: boolean;
  onToggleClearance: (itemId: string) => void;
  onWaive: (itemId: string) => void;
  onAdvance: () => void;
  onBack: () => void;
  onSaveExitInterview: (interview: ExitInterview) => void;
  onSaveSettlement: (settlement: FinalSettlement) => void;
}) {
  const cfg = statusConfig[record.status];
  const allClear = record.clearanceItems.every(
    (ci) => ci.status === 'Complete' || ci.status === 'Waived',
  );
  const canAdvance =
    record.status !== 'Closed' && (record.status !== 'Clearance In Progress' || allClear);

  // Exit interview state
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewConductedBy, setInterviewConductedBy] = useState('Emily Doe');
  const [interviewDeclined, setInterviewDeclined] = useState(false);
  const [interviewQa, setInterviewQa] = useState<{ question: string; answer: string }[]>([
    { question: '', answer: '' },
    { question: '', answer: '' },
    { question: '', answer: '' },
  ]);
  const [interviewError, setInterviewError] = useState<string | null>(null);

  // Settlement state
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementDays, setSettlementDays] = useState('0');
  const [settlementRate, setSettlementRate] = useState('0');
  const [settlementDues, setSettlementDues] = useState<
    { id: string; description: string; amount: number }[]
  >([]);
  const [settlementOutstanding, setSettlementOutstanding] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
      >
        ← Back to offboarding
      </button>

      {/* Header */}
      <Card className="mb-6 overflow-hidden">
        <div className="relative h-20 bg-gradient-to-r from-ink-900 to-ink-700">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute -top-8 right-12 h-32 w-32 rounded-full bg-accent-500/40 blur-3xl" />
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4">
            <Avatar className="-mt-8 h-16 w-16 border-4 border-white shadow-md">
              <AvatarFallback className="bg-ink-900 text-lg text-ink-50">
                {initials(record.employeeName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">
                  {record.employeeName}
                </h2>
                <Badge
                  className={cn(
                    'border-transparent text-[10px]',
                    separationColors[record.separationType],
                  )}
                >
                  {record.separationType}
                </Badge>
                <Badge className={cn('gap-1.5', cfg.badge)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                  {cfg.label}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-500">
                {record.positionName} · Initiated by {record.initiatedBy} on{' '}
                {formatDate(record.initiatedAt)}
              </p>
            </div>
            {!isEmployeeView && canAdvance && (
              <Button variant="accent" onClick={onAdvance}>
                Advance stage
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Meta cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetaCard
          icon={Calendar}
          label="Last working day"
          value={formatDate(record.lastWorkingDay)}
        />
        <MetaCard
          icon={Lock}
          label="Deactivation date"
          value={formatDate(record.deactivationDate)}
          tone={record.deactivationDate ? 'accent' : 'neutral'}
        />
        <MetaCard icon={Users} label="Initiated by" value={record.initiatedBy} />
        <MetaCard
          icon={ClipboardList}
          label="Clearance"
          value={`${record.clearanceItems.filter((ci) => ci.status === 'Complete' || ci.status === 'Waived').length}/${record.clearanceItems.length}`}
          tone={allClear ? 'accent' : 'amber'}
        />
      </div>

      {/* Reason */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-ink-400" />
            Reason for separation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-700">{record.reason}</p>
        </CardContent>
      </Card>

      {/* Clearance checklist */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-ink-400" />
            Clearance checklist
            {!allClear && (
              <Badge className="border-transparent bg-amber-100 text-[10px] text-amber-800">
                {record.clearanceItems.filter((ci) => ci.status === 'Pending').length} pending
              </Badge>
            )}
            {allClear && (
              <Badge className="border-transparent bg-accent-100 text-[10px] text-accent-800">
                <CheckCircle2 className="h-3 w-3" />
                All clear
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {record.clearanceItems.map((ci, i) => {
            const Icon = categoryIcons[ci.category];
            return (
              <motion.div
                key={ci.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.25 }}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-4 transition-colors',
                  ci.status === 'Complete' && 'border-accent-200 bg-accent-50/40',
                  ci.status === 'Waived' && 'border-purple-200 bg-purple-50/40',
                  ci.status === 'Pending' && 'border-ink-200 bg-white',
                )}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    ci.status === 'Complete'
                      ? 'bg-accent-100 text-accent-700'
                      : ci.status === 'Waived'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-ink-100 text-ink-500',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
                      {ci.category}
                    </p>
                    {ci.status === 'Waived' && (
                      <Badge className="border-transparent bg-purple-100 text-[10px] text-purple-700">
                        Waived
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-ink-900">{ci.description}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    Responsible: {ci.responsibleParty}
                    {ci.signOffBy && ` · Signed off by ${ci.signOffBy}`}
                    {ci.completedAt && ` · ${formatDate(ci.completedAt)}`}
                  </p>
                  {ci.waivedReason && (
                    <p className="mt-1 text-xs text-purple-700 italic">Waived: {ci.waivedReason}</p>
                  )}
                </div>
                {!isEmployeeView && (
                  <div className="flex items-center gap-1">
                    {ci.status !== 'Complete' && ci.status !== 'Waived' && (
                      <>
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => onToggleClearance(ci.id)}
                          className="gap-1"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Mark complete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onWaive(ci.id)}
                          className="text-purple-600"
                        >
                          Waive
                        </Button>
                      </>
                    )}
                    {ci.status === 'Complete' && (
                      <Button size="sm" variant="ghost" onClick={() => onToggleClearance(ci.id)}>
                        Reopen
                      </Button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </CardContent>
      </Card>

      {/* Closure warning */}
      {record.status === 'Clearance In Progress' && !allClear && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">Clearance incomplete</p>
            <p className="mt-1 text-xs text-amber-700">
              Offboarding cannot proceed to closure until all clearance items are marked complete or
              waived. Outstanding items:{' '}
              {record.clearanceItems
                .filter((ci) => ci.status === 'Pending')
                .map((ci) => ci.category)
                .join(', ')}
              .
            </p>
          </div>
        </div>
      )}

      {/* Exit interview */}
      {record.exitInterview ? (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-ink-400" />
              Exit interview
            </CardTitle>
            {!isEmployeeView && (
              <Button variant="outline" size="sm" onClick={() => setInterviewOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ink-500">
              Conducted by {record.exitInterview.conductedBy} on{' '}
              {formatDate(record.exitInterview.conductedAt)}
            </p>
            {record.exitInterview.declined && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Employee declined the exit interview.
              </div>
            )}
            {record.exitInterview.responses.map((qa, i) => (
              <div key={i} className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs font-medium text-ink-500">{qa.question}</p>
                <p className="mt-1 text-sm text-ink-900">{qa.answer}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : record.status === 'Closed' ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-ink-400" />
              Exit interview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={FileSignature}
              title="No exit interview recorded"
              description="No exit interview was conducted for this offboarding."
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-ink-400" />
              Exit interview
            </CardTitle>
            {!isEmployeeView && (
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  setInterviewQa([
                    { question: '', answer: '' },
                    { question: '', answer: '' },
                    { question: '', answer: '' },
                  ]);
                  setInterviewDeclined(false);
                  setInterviewConductedBy('Emily Doe');
                  setInterviewError(null);
                  setInterviewOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Conduct interview
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-500">
              Record the exit interview to capture feedback about the employee's experience, reasons
              for leaving, and suggestions for improvement.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Final settlement */}
      {record.settlement ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-ink-400" />
              Final settlement
            </CardTitle>
            {!isEmployeeView && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSettlementDays(record.settlement!.leaveEncashmentDays.toString());
                  setSettlementRate(
                    (
                      record.settlement!.leaveEncashmentAmount /
                      Math.max(record.settlement!.leaveEncashmentDays, 1)
                    ).toString(),
                  );
                  setSettlementDues(
                    record.settlement!.pendingDues.map((d, i) => ({
                      id: `due-${i}`,
                      ...d,
                    })),
                  );
                  setSettlementOutstanding(record.settlement!.outstandingFlagged);
                  setSettlementError(null);
                  setSettlementOpen(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                <div>
                  <p className="text-xs text-ink-500">Last working day</p>
                  <p className="text-sm font-medium text-ink-900">
                    {formatDate(record.settlement.lastWorkingDay)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Leave encashment</p>
                  <p className="text-sm font-medium text-ink-900">
                    {record.settlement.leaveEncashmentDays} days ·{' '}
                    <span className="font-mono">
                      ${record.settlement.leaveEncashmentAmount.toLocaleString()}
                    </span>
                  </p>
                </div>
              </div>
              {record.settlement.pendingDues.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-ink-500">Pending dues</p>
                  {record.settlement.pendingDues.map((due, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-amber-50 p-2 text-sm"
                    >
                      <span className="text-amber-800">{due.description}</span>
                      <span className="font-mono text-amber-800">
                        ${due.amount.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-ink-100 pt-3">
                <span className="text-sm font-medium text-ink-900">Total settlement</span>
                <span className="font-mono text-lg font-bold text-accent-700">
                  ${record.settlement.totalAmount.toLocaleString()}
                </span>
              </div>
              {record.settlement.outstandingFlagged && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Outstanding dues flagged for manual resolution.
                </div>
              )}
              <p className="text-xs text-ink-400">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Note: This is an informational summary. No payroll is processed in this module.
                Settlement amount is for documentation purposes.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : record.status === 'Settlement' || record.status === 'Closed' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-ink-400" />
              Final settlement
            </CardTitle>
            {!isEmployeeView && (
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  setSettlementDays('0');
                  setSettlementRate('0');
                  setSettlementDues([]);
                  setSettlementOutstanding(false);
                  setSettlementError(null);
                  setSettlementOpen(true);
                }}
              >
                <Calculator className="h-3.5 w-3.5" />
                Generate settlement
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={DollarSign}
              title="No settlement generated"
              description="Generate the final settlement with leave encashment and pending dues calculation."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-ink-400" />
              Final settlement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={DollarSign}
              title="Settlement pending"
              description="Advance to the Settlement stage to generate the final settlement."
            />
          </CardContent>
        </Card>
      )}

      {/* Access revocation note */}
      {record.status === 'Closed' && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-accent-200 bg-accent-50 p-4">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" />
          <div>
            <p className="text-sm font-medium text-accent-800">Access revoked</p>
            <p className="mt-1 text-xs text-accent-700">
              System access was automatically deactivated on {formatDate(record.deactivationDate)}.
              The former employee cannot log in.
            </p>
          </div>
        </div>
      )}

      {/* Exit Interview Dialog */}
      <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conduct exit interview</DialogTitle>
            <DialogDescription>
              Record the employee's feedback. All responses are confidential and stored with the
              offboarding record.
            </DialogDescription>
          </DialogHeader>
          {interviewError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {interviewError}
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ei-conducted">Conducted by</Label>
                <Input
                  id="ei-conducted"
                  value={interviewConductedBy}
                  onChange={(e) => setInterviewConductedBy(e.target.value)}
                  placeholder="HR representative name"
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-4 py-2.5 transition-colors hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={interviewDeclined}
                    onChange={(e) => setInterviewDeclined(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-ink-600"
                  />
                  <span className="text-sm text-ink-700">Employee declined interview</span>
                </label>
              </div>
            </div>

            {!interviewDeclined && (
              <>
                <Separator />
                <p className="text-sm font-medium text-ink-700">Interview questions</p>
                {interviewQa.map((qa, idx) => (
                  <div key={idx} className="grid gap-3 rounded-lg border bg-ink-50/50 p-4">
                    <div className="space-y-1.5">
                      <Label htmlFor={`ei-q-${idx}`} className="text-xs text-ink-500">
                        Question {idx + 1}
                      </Label>
                      <Input
                        id={`ei-q-${idx}`}
                        value={qa.question}
                        onChange={(e) => {
                          const updated = [...interviewQa];
                          updated[idx] = { ...updated[idx]!, question: e.target.value };
                          setInterviewQa(updated);
                        }}
                        placeholder="e.g. What is your primary reason for leaving?"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`ei-a-${idx}`} className="text-xs text-ink-500">
                        Response
                      </Label>
                      <Textarea
                        id={`ei-a-${idx}`}
                        value={qa.answer}
                        onChange={(e) => {
                          const updated = [...interviewQa];
                          updated[idx] = { ...updated[idx]!, answer: e.target.value };
                          setInterviewQa(updated);
                        }}
                        placeholder="Employee's response..."
                        rows={2}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setInterviewQa((prev) => [...prev, { question: '', answer: '' }])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add question
                  </Button>
                  {interviewQa.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setInterviewQa((prev) => prev.slice(0, -1))}
                    >
                      <Minus className="h-3.5 w-3.5" />
                      Remove last
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInterviewOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                setInterviewError(null);
                if (!interviewConductedBy.trim()) {
                  setInterviewError(
                    'Please enter the name of the person conducting the interview.',
                  );
                  return;
                }
                const validResponses = interviewDeclined
                  ? []
                  : interviewQa.filter((qa) => qa.question.trim() && qa.answer.trim());
                if (!interviewDeclined && validResponses.length === 0) {
                  setInterviewError('Please fill in at least one question and response.');
                  return;
                }
                const interview: ExitInterview = {
                  conductedBy: interviewConductedBy.trim(),
                  conductedAt: new Date().toISOString(),
                  declined: interviewDeclined,
                  responses: validResponses,
                };
                onSaveExitInterview(interview);
                setInterviewOpen(false);
              }}
            >
              <FileText className="h-4 w-4" />
              Save interview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settlement Dialog */}
      <Dialog open={settlementOpen} onOpenChange={setSettlementOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Generate final settlement</DialogTitle>
            <DialogDescription>
              Calculate leave encashment and record any pending dues. The total is for documentation
              and does not trigger payroll processing.
            </DialogDescription>
          </DialogHeader>
          {settlementError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {settlementError}
            </div>
          )}
          <div className="space-y-5 py-2">
            {/* Leave encashment */}
            <div className="space-y-3 rounded-lg border bg-ink-50/50 p-4">
              <p className="text-sm font-medium text-ink-700">Leave encashment</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="settle-days">Encashment days</Label>
                  <Input
                    id="settle-days"
                    type="number"
                    min="0"
                    value={settlementDays}
                    onChange={(e) => setSettlementDays(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="settle-rate">Daily rate ($)</Label>
                  <Input
                    id="settle-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={settlementRate}
                    onChange={(e) => setSettlementRate(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white p-3">
                <span className="text-sm text-ink-600">Leave encashment amount</span>
                <span className="font-mono text-lg font-bold text-accent-700">
                  $
                  {(
                    (parseFloat(settlementDays) || 0) * (parseFloat(settlementRate) || 0)
                  ).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            {/* Pending dues */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-700">Pending dues / deductions</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSettlementDues((prev) => [
                      ...prev,
                      { id: `due-${Date.now()}`, description: '', amount: 0 },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add due
                </Button>
              </div>
              {settlementDues.length === 0 && (
                <p className="text-xs text-ink-400">No pending dues recorded.</p>
              )}
              {settlementDues.map((due, idx) => (
                <div key={due.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="flex-1 space-y-2">
                    <Input
                      placeholder="Description (e.g. Equipment damage)"
                      value={due.description}
                      onChange={(e) => {
                        const updated = [...settlementDues];
                        updated[idx] = { ...updated[idx]!, description: e.target.value };
                        setSettlementDues(updated);
                      }}
                      className="h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Amount"
                      value={due.amount || ''}
                      onChange={(e) => {
                        const updated = [...settlementDues];
                        updated[idx] = {
                          ...updated[idx]!,
                          amount: parseFloat(e.target.value) || 0,
                        };
                        setSettlementDues(updated);
                      }}
                      className="h-8 text-sm"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-8 w-8 text-ink-400 hover:text-red-500"
                    onClick={() => setSettlementDues((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Outstanding flag */}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <input
                type="checkbox"
                checked={settlementOutstanding}
                onChange={(e) => setSettlementOutstanding(e.target.checked)}
                className="h-4 w-4 rounded border-amber-300 text-amber-600"
              />
              <div>
                <p className="text-sm font-medium text-amber-800">Flag outstanding issues</p>
                <p className="text-xs text-amber-600">
                  Check if there are unresolved dues requiring manual resolution after offboarding.
                </p>
              </div>
            </label>

            {/* Total */}
            <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-accent-800">Total settlement</span>
                <span className="font-mono text-xl font-bold text-accent-700">
                  $
                  {(
                    (parseFloat(settlementDays) || 0) * (parseFloat(settlementRate) || 0) -
                    settlementDues.reduce((sum, d) => sum + (d.amount || 0), 0)
                  ).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                setSettlementError(null);
                const encashDays = parseFloat(settlementDays) || 0;
                const encashRate = parseFloat(settlementRate) || 0;
                const encashAmount = encashDays * encashRate;
                const duesTotal = settlementDues.reduce((sum, d) => sum + (d.amount || 0), 0);

                if (encashDays < 0) {
                  setSettlementError('Encashment days cannot be negative.');
                  return;
                }

                const settlement: FinalSettlement = {
                  generatedAt: new Date().toISOString(),
                  lastWorkingDay: record.lastWorkingDay,
                  leaveEncashmentDays: encashDays,
                  leaveEncashmentAmount: encashAmount,
                  pendingDues: settlementDues
                    .filter((d) => d.description.trim())
                    .map((d) => ({ description: d.description.trim(), amount: d.amount })),
                  totalAmount: encashAmount - duesTotal,
                  outstandingFlagged: settlementOutstanding,
                };
                onSaveSettlement(settlement);
                setSettlementOpen(false);
              }}
            >
              <FileText className="h-4 w-4" />
              Save settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetaCard({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  tone?: 'neutral' | 'accent' | 'amber';
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            tone === 'accent' && 'bg-accent-100 text-accent-700',
            tone === 'amber' && 'bg-amber-100 text-amber-600',
            tone === 'neutral' && 'bg-ink-100 text-ink-600',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] tracking-wide text-ink-400 uppercase">{label}</p>
          <p className="truncate text-sm font-medium text-ink-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  delay = 0,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone?: 'neutral' | 'accent' | 'amber';
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              tone === 'accent' && 'bg-accent-100 text-accent-700',
              tone === 'amber' && 'bg-amber-100 text-amber-600',
              tone === 'neutral' && 'bg-ink-100 text-ink-600',
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              {value}
            </div>
            <div className="text-xs text-ink-500">{label}</div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
