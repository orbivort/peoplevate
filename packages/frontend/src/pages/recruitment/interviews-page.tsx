import { motion } from 'framer-motion';
import { CalendarClock, CheckCircle2, MapPin, Plus, Trash2, Video, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useDepartments } from '@/data/data-layer';
import { recruitmentRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDateTime } from '@/lib/utils';
import type { Candidate, Interview, JobRequisition } from '@/types';

const statusStyles: Record<Interview['status'], string> = {
  Scheduled: 'bg-blue-100 text-blue-700',
  Completed: 'bg-accent-100 text-accent-800',
  Cancelled: 'bg-red-100 text-red-700',
};

interface ScheduleForm {
  candidateId: string;
  scheduledAt: string;
  durationMin: number;
  interviewers: string;
  location: string;
  notes: string;
}

export function InterviewsPage() {
  const { hasPermission, employee } = useAuth();
  const isHrOrAdmin = hasPermission('manageRecruitment');
  const canManageDept = hasPermission('manageRecruitmentDept');
  const canManagePipeline = isHrOrAdmin || canManageDept;
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobRequisitions, setJobRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const managerDeptId = !isHrOrAdmin && canManageDept && employee ? employee.departmentId : null;
  const [deptFilter, setDeptFilter] = useState<string>(managerDeptId ?? 'all');
  const [reqFilter, setReqFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ScheduleForm>({
    candidateId: '',
    scheduledAt: '',
    durationMin: 60,
    interviewers: '',
    location: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: departments } = useDepartments();

  const load = useCallback(async () => {
    try {
      const [reqs, cands] = await Promise.all([
        recruitmentRepo.listRequisitions(),
        recruitmentRepo.listCandidates(),
      ]);
      setJobRequisitions(reqs);
      setCandidates(cands);
      // Backend exposes interviews per-candidate; aggregate across candidates in scope.
      const allInterviews: Interview[] = [];
      await Promise.all(
        cands.map(async (c) => {
          try {
            allInterviews.push(...(await recruitmentRepo.listInterviews(c.id)));
          } catch {
            // Skip candidates whose interviews cannot be listed.
          }
        }),
      );
      setInterviews(allInterviews);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load interviews.');
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

  // Available requisitions scoped by department filter
  const availableRequisitions = useMemo(() => {
    let reqs = jobRequisitions.filter((r) => r.status === 'Published' || r.status === 'Approved');
    if (deptFilter !== 'all') {
      reqs = reqs.filter((r) => r.departmentId === deptFilter);
    }
    if (canManageDept && !isHrOrAdmin && employee) {
      reqs = reqs.filter((r) => r.departmentId === employee.departmentId);
    }
    return reqs;
  }, [deptFilter, canManageDept, isHrOrAdmin, employee, jobRequisitions]);

  const visiblePool = useMemo(() => {
    let result = interviews;
    // Manager sees only interviews for candidates in their department's requisitions
    if (canManageDept && !isHrOrAdmin && employee) {
      const deptReqIds = new Set(
        jobRequisitions.filter((r) => r.departmentId === employee.departmentId).map((r) => r.id),
      );
      const deptCandidateIds = new Set(
        candidates.filter((c) => deptReqIds.has(c.requisitionId)).map((c) => c.id),
      );
      result = result.filter((iv) => deptCandidateIds.has(iv.candidateId));
    }
    // Apply department filter (HR only; for managers this is locked)
    if (deptFilter !== 'all') {
      const deptReqIds = new Set(
        jobRequisitions.filter((r) => r.departmentId === deptFilter).map((r) => r.id),
      );
      const deptCandidateIds = new Set(
        candidates.filter((c) => deptReqIds.has(c.requisitionId)).map((c) => c.id),
      );
      result = result.filter((iv) => deptCandidateIds.has(iv.candidateId));
    }
    // Apply requisition filter
    if (reqFilter !== 'all') {
      const reqCandidateIds = new Set(
        candidates.filter((c) => c.requisitionId === reqFilter).map((c) => c.id),
      );
      result = result.filter((iv) => reqCandidateIds.has(iv.candidateId));
    }
    return result;
  }, [
    interviews,
    candidates,
    jobRequisitions,
    deptFilter,
    reqFilter,
    canManageDept,
    isHrOrAdmin,
    employee,
  ]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return visiblePool;
    return visiblePool.filter((iv) => iv.status === statusFilter);
  }, [visiblePool, statusFilter]);

  const hasActiveFilters = deptFilter !== 'all' || reqFilter !== 'all' || statusFilter !== 'all';

  const clearFilters = () => {
    setDeptFilter(managerDeptId ?? 'all');
    setReqFilter('all');
    setStatusFilter('all');
  };

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [filtered],
  );

  const updateStatus = async (iv: Interview, status: Interview['status']) => {
    const statusMap: Record<Interview['status'], string> = {
      Scheduled: 'SCHEDULED',
      Completed: 'COMPLETED',
      Cancelled: 'CANCELLED',
    };
    try {
      await recruitmentRepo.updateInterviewStatus(iv.candidateId, iv.id, statusMap[status]);
      setInterviews((prev) => prev.map((item) => (item.id === iv.id ? { ...item, status } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update interview status.');
    }
  };

  const removeInterview = async (iv: Interview) => {
    try {
      await recruitmentRepo.deleteInterview(iv.candidateId, iv.id);
      setInterviews((prev) => prev.filter((item) => item.id !== iv.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete interview.');
    }
  };

  const openCreate = () => {
    setForm({
      candidateId: '',
      scheduledAt: '',
      durationMin: 60,
      interviewers: '',
      location: '',
      notes: '',
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    setError(null);
    if (!form.candidateId) {
      setError('Please select a candidate.');
      return;
    }
    if (!form.scheduledAt) {
      setError('Please pick a date and time.');
      return;
    }
    try {
      await recruitmentRepo.createInterview(form.candidateId, {
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        durationMin: form.durationMin,
        interviewerIds: form.interviewers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        location: form.location || undefined,
        notes: form.notes || undefined,
      });
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule interview.');
    }
  };

  // Tab counts respect all filters
  const counts = {
    all: visiblePool.length,
    Scheduled: visiblePool.filter((i) => i.status === 'Scheduled').length,
    Completed: visiblePool.filter((i) => i.status === 'Completed').length,
    Cancelled: visiblePool.filter((i) => i.status === 'Cancelled').length,
  };

  return (
    <div>
      <PageHeader
        title="Interviews"
        description={
          isHrOrAdmin
            ? 'Schedule and track interviews across all open requisitions.'
            : 'Schedule and track interviews for your department.'
        }
        actions={
          canManagePipeline && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Schedule interview
            </Button>
          )
        }
      />

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
        <Select value={reqFilter} onValueChange={setReqFilter}>
          <SelectTrigger className="h-9 w-[280px] text-sm">
            <SelectValue placeholder="All requisitions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All requisitions</SelectItem>
            {availableRequisitions.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isHrOrAdmin && (
          <Select
            value={deptFilter}
            onValueChange={(v) => {
              setDeptFilter(v);
              setReqFilter('all');
            }}
          >
            <SelectTrigger className="h-9 w-[200px] text-sm">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hasActiveFilters && (
          <>
            <div className="h-5 w-px bg-ink-200" />
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 gap-1.5 text-xs text-ink-500 hover:text-ink-700"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
            <Badge className="border-transparent bg-accent-100 text-[11px] text-accent-800">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </Badge>
          </>
        )}
      </div>

      {/* Status tabs */}
      <div className="mb-4 flex gap-1">
        {(['all', 'Scheduled', 'Completed', 'Cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === s
                ? 'bg-ink-900 text-ink-50'
                : 'bg-white text-ink-600 hover:bg-ink-100',
            )}
          >
            {s === 'all' ? 'All' : s}
            <span className="ml-1.5 text-xs opacity-70">{counts[s as keyof typeof counts]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <div className="flex h-40 items-center justify-center text-sm text-ink-500">
            Loading interviews…
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No interviews scheduled"
            description="Schedule interviews to coordinate with your hiring team and candidates."
            action={
              canManagePipeline ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Schedule interview
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Interviewers</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((iv, i) => (
                  <motion.tr
                    key={iv.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className="group"
                  >
                    <TableCell className="font-medium text-ink-900">{iv.candidateName}</TableCell>
                    <TableCell className="text-sm text-ink-600">{iv.requisitionTitle}</TableCell>
                    <TableCell className="text-sm text-ink-600">
                      {formatDateTime(iv.scheduledAt)}
                    </TableCell>
                    <TableCell className="text-sm text-ink-600">{iv.durationMin} min</TableCell>
                    <TableCell className="text-sm text-ink-600">
                      <div className="flex flex-wrap gap-1">
                        {iv.interviewers.length > 0 ? (
                          iv.interviewers.map((name, idx) => (
                            <Badge key={idx} variant="secondary" className="text-[10px]">
                              {name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-ink-600">
                      <span className="inline-flex items-center gap-1">
                        {iv.location.toLowerCase().includes('zoom') ||
                        iv.location.toLowerCase().includes('meet') ||
                        iv.location.toLowerCase().includes('video') ? (
                          <Video className="h-3 w-3 text-ink-400" />
                        ) : (
                          <MapPin className="h-3 w-3 text-ink-400" />
                        )}
                        {iv.location}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn('border-transparent text-[10px]', statusStyles[iv.status])}
                      >
                        {iv.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {canManagePipeline && (
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          {iv.status === 'Scheduled' && (
                            <>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-accent-600 hover:text-accent-700"
                                onClick={() => updateStatus(iv, 'Completed')}
                                title="Mark completed"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-red-400 hover:text-red-600"
                                onClick={() => updateStatus(iv, 'Cancelled')}
                                title="Cancel"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-ink-400 hover:text-red-600"
                            onClick={() => removeInterview(iv)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Schedule dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule interview</DialogTitle>
            <DialogDescription>
              Coordinate an interview with the candidate and your hiring team.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Candidate *</Label>
              <Select
                value={form.candidateId}
                onValueChange={(v) => setForm((f) => ({ ...f, candidateId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a candidate" />
                </SelectTrigger>
                <SelectContent>
                  {candidates
                    .filter((c) => c.stage !== 'Rejected' && c.stage !== 'Hired')
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.requisitionTitle}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Date &amp; time *</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Duration (min)</Label>
                <Select
                  value={String(form.durationMin)}
                  onValueChange={(v) => setForm((f) => ({ ...f, durationMin: Number(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[30, 45, 60, 90, 120].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} minutes
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Interviewers (comma-separated)</Label>
              <Input
                value={form.interviewers}
                onChange={(e) => setForm((f) => ({ ...f, interviewers: e.target.value }))}
                placeholder="e.g. Grace Liu, David Kim"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Location / meeting link</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Conference Room A or Zoom link"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Focus areas, prep instructions…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={handleCreate}>
              <CalendarClock className="h-4 w-4" />
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
