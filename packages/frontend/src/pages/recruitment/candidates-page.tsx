import { motion } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  FileText,
  Plus,
  UserCheck,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import { useDepartments, usePositions } from '@/data/data-layer';
import { recruitmentRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate, initials } from '@/lib/utils';
import type { Candidate, CandidateStage, CandidateSource, JobRequisition } from '@/types';

const sourceToBackend: Record<CandidateSource, string> = {
  Referral: 'REFERRAL',
  'Job Board': 'JOB_BOARD',
  Direct: 'DIRECT',
  Internal: 'INTERNAL',
};

const stageToBackend: Record<CandidateStage, string> = {
  Applied: 'APPLIED',
  Screening: 'SCREENING',
  Interview: 'INTERVIEW',
  Offer: 'OFFER',
  Hired: 'HIRED',
  Rejected: 'REJECTED',
};

const stages: { key: CandidateStage; label: string; accent: string; dot: string }[] = [
  { key: 'Applied', label: 'Applied', accent: 'border-ink-300', dot: 'bg-ink-400' },
  { key: 'Screening', label: 'Screening', accent: 'border-blue-400', dot: 'bg-blue-500' },
  { key: 'Interview', label: 'Interview', accent: 'border-amber-400', dot: 'bg-amber-500' },
  { key: 'Offer', label: 'Offer', accent: 'border-purple-400', dot: 'bg-purple-500' },
  { key: 'Hired', label: 'Hired', accent: 'border-accent-400', dot: 'bg-accent-500' },
];

const stageOrder: CandidateStage[] = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];

// Mirrors the backend CANDIDATE_TRANSITIONS map so the UI only ever offers
// transitions the server will accept. This keeps the "<"/">" controls
// consistent with the backend state machine and prevents silent failures.
const stageTransitions: Record<CandidateStage, CandidateStage[]> = {
  Applied: ['Screening', 'Rejected'],
  Screening: ['Interview', 'Rejected', 'Applied'],
  Interview: ['Offer', 'Rejected', 'Screening', 'Applied'],
  Offer: ['Hired', 'Rejected', 'Interview'],
  Hired: ['Rejected'],
  Rejected: ['Applied', 'Screening'],
};

// Given a candidate stage and a horizontal move, returns the resulting stage
// if that move is permitted by the backend state machine, otherwise null.
const stageAfterMove = (stage: CandidateStage, direction: 1 | -1): CandidateStage | null => {
  const idx = stageOrder.indexOf(stage);
  if (idx < 0) return null;
  const neighbor = stageOrder[idx + direction];
  if (!neighbor) return null;
  return (stageTransitions[stage] ?? []).includes(neighbor) ? neighbor : null;
};

const sourceColors: Record<CandidateSource, string> = {
  Referral: 'bg-accent-100 text-accent-800',
  'Job Board': 'bg-blue-100 text-blue-700',
  Direct: 'bg-ink-100 text-ink-700',
  Internal: 'bg-purple-100 text-purple-700',
};

interface CandForm {
  name: string;
  email: string;
  phone: string;
  requisitionId: string;
  source: CandidateSource;
  resumeFilename: string;
}

export function CandidatesPage() {
  const { hasPermission, employee } = useAuth();
  const isHrOrAdmin = hasPermission('manageRecruitment');
  const canManageDept = hasPermission('manageRecruitmentDept');
  const canManagePipeline = isHrOrAdmin || canManageDept;
  const isManager = canManageDept && !isHrOrAdmin;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const reqFilter = params.get('req') ?? 'all';
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobRequisitions, setJobRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rejectDialogFor, setRejectDialogFor] = useState<Candidate | null>(null);
  const [convertDialogFor, setConvertDialogFor] = useState<Candidate | null>(null);
  const [convertedEmployeeId, setConvertedEmployeeId] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({
    departmentId: '',
    positionId: '',
    startDate: '',
  });
  const [convertError, setConvertError] = useState<string | null>(null);
  const [form, setForm] = useState<CandForm>({
    name: '',
    email: '',
    phone: '',
    requisitionId: '',
    source: 'Direct',
    resumeFilename: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();

  const load = useCallback(async () => {
    // Load candidates and requisitions independently so a failure in one (e.g.
    // a Manager without candidate access) never blocks the other — otherwise the
    // Add Candidate dialog's Requisition dropdown could stay empty.
    const [candsResult, reqsResult] = await Promise.allSettled([
      recruitmentRepo.listCandidates(reqFilter !== 'all' ? reqFilter : undefined),
      recruitmentRepo.listRequisitions(),
    ]);

    if (candsResult.status === 'fulfilled') {
      setCandidates(candsResult.value);
    } else {
      setError(
        candsResult.reason instanceof Error
          ? candsResult.reason.message
          : 'Failed to load candidates.',
      );
      setCandidates([]);
    }

    if (reqsResult.status === 'fulfilled') {
      setJobRequisitions(reqsResult.value);
    } else {
      setJobRequisitions([]);
    }

    setLoading(false);
  }, [reqFilter]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Filter state
  // Managers default to their own department and cannot change it
  const managerDeptId = !isHrOrAdmin && canManageDept && employee ? employee.departmentId : null;
  const [deptFilter, setDeptFilter] = useState<string>(managerDeptId ?? 'all');
  const [reqFilterLocal, setReqFilterLocal] = useState<string>('all');

  // Available departments for the filter dropdown — HR sees all; Manager sees only their own
  const availableDepartments = useMemo(() => {
    if (isHrOrAdmin) return departments;
    if (employee) return departments.filter((d) => d.id === employee.departmentId);
    return [];
  }, [isHrOrAdmin, employee, departments]);

  // Available requisitions for the filter dropdown, scoped by department filter
  const availableRequisitions = useMemo(() => {
    let reqs = jobRequisitions.filter((r) => r.status === 'Published' || r.status === 'Approved');
    if (deptFilter !== 'all') {
      reqs = reqs.filter((r) => r.departmentId === deptFilter);
    }
    // For Managers, further scope to their department
    if (canManageDept && !isHrOrAdmin && employee) {
      reqs = reqs.filter((r) => r.departmentId === employee.departmentId);
    }
    return reqs;
  }, [deptFilter, canManageDept, isHrOrAdmin, employee, jobRequisitions]);

  // For managers, the dept filter is always active (locked to their dept)
  const hasActiveFilters = deptFilter !== 'all' || reqFilterLocal !== 'all';

  const clearFilters = () => {
    // Managers keep their department locked; only clear the requisition filter
    setDeptFilter(managerDeptId ?? 'all');
    setReqFilterLocal('all');
    setParams({});
  };

  const filteredCandidates = useMemo(() => {
    let result = candidates;
    // Manager sees only candidates linked to their department's requisitions
    if (canManageDept && !isHrOrAdmin && employee) {
      const deptReqIds = new Set(
        jobRequisitions.filter((r) => r.departmentId === employee.departmentId).map((r) => r.id),
      );
      result = result.filter((c) => deptReqIds.has(c.requisitionId));
    }
    // Apply department filter
    if (deptFilter !== 'all') {
      const deptReqIds = new Set(
        jobRequisitions.filter((r) => r.departmentId === deptFilter).map((r) => r.id),
      );
      result = result.filter((c) => deptReqIds.has(c.requisitionId));
    }
    // Apply requisition filter: prefer local filter, fall back to URL param
    const effectiveReqFilter = reqFilterLocal !== 'all' ? reqFilterLocal : reqFilter;
    if (effectiveReqFilter !== 'all') {
      result = result.filter((c) => c.requisitionId === effectiveReqFilter);
    }
    return result;
  }, [
    candidates,
    reqFilter,
    reqFilterLocal,
    deptFilter,
    canManageDept,
    isHrOrAdmin,
    employee,
    jobRequisitions,
  ]);

  const effectiveReqFilter = reqFilterLocal !== 'all' ? reqFilterLocal : reqFilter;
  const activeReq = jobRequisitions.find((r) => r.id === effectiveReqFilter);

  // Active filter label for the description
  const filterDescription = useMemo(() => {
    if (activeReq) return `Candidates for: ${activeReq.title}`;
    if (deptFilter !== 'all') {
      const dept = departments.find((d) => d.id === deptFilter);
      if (dept) return `Candidates in ${dept.name} department`;
    }
    return isHrOrAdmin
      ? 'Track candidates through recruitment stages — from application to hire.'
      : 'Track candidates for your department through recruitment stages.';
  }, [activeReq, deptFilter, isHrOrAdmin, departments]);

  const byStage = (stage: CandidateStage) => filteredCandidates.filter((c) => c.stage === stage);

  const rejected = filteredCandidates.filter((c) => c.stage === 'Rejected');

  const [movingCandidateId, setMovingCandidateId] = useState<string | null>(null);

  const moveStage = async (candidate: Candidate, direction: 1 | -1) => {
    // Only move to a stage the backend state machine will accept, so the
    // button never triggers a failing request (e.g. Hired -> Offer).
    const nextStage = stageAfterMove(candidate.stage, direction);
    if (!nextStage || nextStage === candidate.stage) return;
    // Managers cannot move a candidate forward to the Hired stage (HR-only).
    if (isManager && nextStage === 'Hired') return;
    setError(null);
    setMovingCandidateId(candidate.id);
    try {
      await recruitmentRepo.updateCandidateStage(candidate.id, stageToBackend[nextStage]!);
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                stage: nextStage,
                stageHistory: [
                  ...c.stageHistory,
                  {
                    stage: nextStage,
                    at: new Date().toISOString(),
                    by: employee ? `${employee.firstName} ${employee.lastName}` : 'System',
                  },
                ],
              }
            : c,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update candidate stage.');
    } finally {
      setMovingCandidateId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectDialogFor) return;
    try {
      await recruitmentRepo.updateCandidateStage(rejectDialogFor.id, 'REJECTED');
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === rejectDialogFor.id
            ? {
                ...c,
                stage: 'Rejected',
                stageHistory: [
                  ...c.stageHistory,
                  {
                    stage: 'Rejected' as CandidateStage,
                    at: new Date().toISOString(),
                    by: employee ? `${employee.firstName} ${employee.lastName}` : 'System',
                  },
                ],
              }
            : c,
        ),
      );
      setRejectDialogFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject candidate.');
    }
  };

  const openConvert = (cand: Candidate) => {
    setConvertDialogFor(cand);
    setConvertError(null);
    setConvertedEmployeeId(null);
    // Pre-fill with a sensible default department/position if possible
    const req = jobRequisitions.find((r) => r.id === cand.requisitionId);
    const matchingPos = req ? positions.find((p) => p.id === req.positionId) : undefined;
    setConvertForm({
      departmentId: matchingPos?.departmentId ?? departments[0]?.id ?? '',
      positionId: matchingPos?.id ?? '',
      startDate: new Date().toISOString().slice(0, 10),
    });
  };

  const handleConvert = async () => {
    setConvertError(null);
    if (!convertDialogFor) return;
    if (!convertForm.departmentId) {
      setConvertError('Please select a department.');
      return;
    }
    if (!convertForm.positionId) {
      setConvertError('Please select a position.');
      return;
    }
    try {
      const result = await recruitmentRepo.convertCandidate(convertDialogFor.id, {
        departmentId: convertForm.departmentId,
        positionId: convertForm.positionId,
        hireDate: convertForm.startDate,
      });
      const employeeId =
        (result as { employeeId?: string } | null)?.employeeId ??
        (result as { id?: string } | null)?.id ??
        '';
      setConvertedEmployeeId(employeeId);
      await load();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Failed to convert candidate.');
    }
  };

  const finishConvert = () => {
    if (convertedEmployeeId) {
      navigate(`/app/employees/${convertedEmployeeId}`);
    } else {
      setConvertDialogFor(null);
    }
  };

  const openCreate = () => {
    setForm({
      name: '',
      email: '',
      phone: '',
      requisitionId: effectiveReqFilter !== 'all' ? effectiveReqFilter : '',
      source: 'Direct',
      resumeFilename: '',
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Candidate name is required.');
      return;
    }
    if (!form.email.trim()) {
      setError('Candidate email is required.');
      return;
    }
    if (!form.requisitionId) {
      setError('Please link this candidate to a requisition.');
      return;
    }
    try {
      await recruitmentRepo.createCandidate({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        source: sourceToBackend[form.source],
        requisitionId: form.requisitionId,
        consentRecorded: true,
      });
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create candidate.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Candidate Pipeline"
        description={filterDescription}
        actions={
          canManagePipeline && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add candidate
            </Button>
          )
        }
      />

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
        <Select value={reqFilterLocal} onValueChange={setReqFilterLocal}>
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
              setReqFilterLocal('all');
            }}
          >
            <SelectTrigger className="h-9 w-[200px] text-sm">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {availableDepartments.map((d) => (
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
              {filteredCandidates.length} result{filteredCandidates.length !== 1 ? 's' : ''}
            </Badge>
          </>
        )}
      </div>

      {/* Page-level error feedback (e.g. failed stage moves) */}
      {error && !dialogOpen && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cursor-pointer rounded p-0.5 text-ink-400 hover:text-ink-600"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Kanban board */}
      {loading ? (
        <Card>
          <div className="flex h-40 items-center justify-center text-sm text-ink-500">
            Loading candidates…
          </div>
        </Card>
      ) : filteredCandidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No candidates yet"
            description="Add candidates manually or they will appear here automatically when they apply."
            action={
              canManagePipeline ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Add candidate
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {stages.map((stage) => {
            const items = byStage(stage.key);
            return (
              <div key={stage.key} className="flex flex-col">
                <div
                  className={cn(
                    'mb-2 flex items-center justify-between rounded-lg border-l-4 bg-white px-3 py-2 shadow-sm',
                    stage.accent,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', stage.dot)} />
                    <span className="text-sm font-semibold text-ink-900">{stage.label}</span>
                  </div>
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2">
                  {items.map((cand, i) => (
                    <motion.div
                      key={cand.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.25 }}
                    >
                      <Card className="cursor-default p-3 transition-shadow hover:shadow-md">
                        <div className="flex items-start gap-2.5">
                          <Avatar className="h-9 w-9 shrink-0">
                            <AvatarFallback className="bg-ink-900 text-xs text-ink-50">
                              {initials(cand.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-900">{cand.name}</p>
                            <p className="truncate text-xs text-ink-500">{cand.email}</p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between">
                          <Badge
                            className={cn(
                              'border-transparent text-[10px]',
                              sourceColors[cand.source],
                            )}
                          >
                            {cand.source}
                          </Badge>
                          {cand.resumeFilename && <FileText className="h-3.5 w-3.5 text-ink-400" />}
                        </div>
                        <p className="mt-2 truncate text-[11px] text-ink-400">
                          Applied {formatDate(cand.appliedAt, { month: 'short', day: 'numeric' })}
                        </p>
                        {/* Stage controls — visible to HR/Admin and Managers with dept scope.
                            Managers cannot act on candidates in the Hired stage, and cannot
                            advance a candidate forward to the Hired stage (HR-only). */}
                        {canManagePipeline && !(isManager && cand.stage === 'Hired') && (
                          <div className="mt-2.5 flex items-center gap-1 border-t border-ink-100 pt-2.5">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={!!cand.employeeId || !stageAfterMove(cand.stage, -1)}
                              onClick={() => moveStage(cand, -1)}
                              title={
                                cand.employeeId
                                  ? 'Candidate already converted to an employee'
                                  : !stageAfterMove(cand.stage, -1)
                                    ? 'This candidate cannot be moved back from its current stage'
                                    : 'Move back'
                              }
                            >
                              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                            </Button>
                            <span className="flex-1 text-center text-[10px] font-medium tracking-wide text-ink-400 uppercase">
                              {stageOrder.indexOf(cand.stage) + 1}/{stageOrder.length}
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={
                                !!cand.employeeId ||
                                !stageAfterMove(cand.stage, 1) ||
                                (isManager && stageAfterMove(cand.stage, 1) === 'Hired')
                              }
                              onClick={() => moveStage(cand, 1)}
                              title={
                                cand.employeeId
                                  ? 'Candidate already converted to an employee'
                                  : !stageAfterMove(cand.stage, 1)
                                    ? 'This candidate cannot be moved forward from its current stage'
                                    : isManager && stageAfterMove(cand.stage, 1) === 'Hired'
                                      ? 'Only HR can move a candidate to the Hired stage'
                                      : 'Advance'
                              }
                            >
                              {movingCandidateId === cand.id ? (
                                <span className="size-3.5 animate-spin rounded-full border-2 border-accent-600/30 border-t-accent-600" />
                              ) : (
                                <ArrowRight className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={!!cand.employeeId}
                              className={cn(
                                'text-red-400 hover:text-red-600',
                                cand.employeeId &&
                                  'cursor-not-allowed opacity-50 hover:text-red-400',
                              )}
                              onClick={() => setRejectDialogFor(cand)}
                              title={
                                cand.employeeId
                                  ? 'Candidate already converted to an employee'
                                  : 'Reject'
                              }
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {/* Convert to Employee button — HR/Admin only (FR-012) */}
                        {cand.stage === 'Hired' &&
                          isHrOrAdmin &&
                          (cand.employeeId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled
                              className="mt-2 w-full cursor-not-allowed text-ink-400"
                              title="This candidate has already been converted to an employee"
                            >
                              <BadgeCheck className="h-3.5 w-3.5" />
                              Converted
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="accent"
                              className="mt-2 w-full"
                              onClick={() => openConvert(cand)}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Convert to Employee
                            </Button>
                          ))}
                      </Card>
                    </motion.div>
                  ))}
                  {items.length === 0 && (
                    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-ink-200 text-xs text-ink-400">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rejected pool */}
      {rejected.length > 0 && (
        <Card className="mt-6">
          <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
            <XCircle className="h-4 w-4 text-red-400" />
            <span className="text-sm font-semibold text-ink-700">
              Rejected candidates ({rejected.length})
            </span>
          </div>
          <CardContent className="p-0">
            <div className="divide-y divide-ink-100">
              {rejected.map((cand) => (
                <div key={cand.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  <span className="font-medium text-ink-800">{cand.name}</span>
                  <span className="text-ink-400">·</span>
                  <span className="text-ink-500">{cand.requisitionTitle}</span>
                  <span className="ml-auto text-xs text-ink-400">
                    Rejected{' '}
                    {formatDate(
                      cand.stageHistory.find((h) => h.stage === 'Rejected')?.at ?? cand.appliedAt,
                      { month: 'short', day: 'numeric' },
                    )}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add candidate</DialogTitle>
            <DialogDescription>
              Record a new candidate application. PII consent is captured automatically.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cand-name">Full name *</Label>
                <Input
                  id="cand-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Doe"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-phone">Phone</Label>
                <Input
                  id="cand-phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+1 415 555 0000"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cand-email">Email *</Label>
              <Input
                id="cand-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@email.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Requisition *</Label>
                <Select
                  value={form.requisitionId}
                  onValueChange={(v) => setForm((f) => ({ ...f, requisitionId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select requisition" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobRequisitions
                      .filter((r) => r.status === 'Published' || r.status === 'Approved')
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select
                  value={form.source}
                  onValueChange={(v) => setForm((f) => ({ ...f, source: v as CandidateSource }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Referral">Referral</SelectItem>
                    <SelectItem value="Job Board">Job Board</SelectItem>
                    <SelectItem value="Direct">Direct</SelectItem>
                    <SelectItem value="Internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cand-resume">Resume filename</Label>
              <Input
                id="cand-resume"
                value={form.resumeFilename}
                onChange={(e) => setForm((f) => ({ ...f, resumeFilename: e.target.value }))}
                placeholder="jane-doe-resume.pdf"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>
              <UserPlus className="h-4 w-4" />
              Add candidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectDialogFor} onOpenChange={(open) => !open && setRejectDialogFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject candidate</DialogTitle>
            <DialogDescription>
              {rejectDialogFor?.name} will be moved to the rejected pool. This action is
              audit-logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogFor(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReject}>
              Reject candidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Employee dialog (FR-012) */}
      <Dialog open={!!convertDialogFor} onOpenChange={(open) => !open && setConvertDialogFor(null)}>
        <DialogContent>
          {convertedEmployeeId ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-accent-600" />
                  Employee created
                </DialogTitle>
                <DialogDescription>
                  {convertDialogFor?.name} has been successfully converted to an employee. You can
                  now view and complete their employee profile.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConvertDialogFor(null)}>
                  Stay here
                </Button>
                <Button onClick={finishConvert}>View employee profile</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-accent-600" />
                  Convert to Employee
                </DialogTitle>
                <DialogDescription>
                  Create a new employee record from{' '}
                  <span className="font-medium text-ink-700">{convertDialogFor?.name}</span>. Some
                  fields will be pre-filled from the candidate profile.
                </DialogDescription>
              </DialogHeader>
              {convertError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {convertError}
                </div>
              )}
              <div className="space-y-4 py-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-ink-500">Email</Label>
                    <p className="text-sm text-ink-800">{convertDialogFor?.email}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-ink-500">Phone</Label>
                    <p className="text-sm text-ink-800">{convertDialogFor?.phone}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Department *</Label>
                    <Select
                      value={convertForm.departmentId}
                      onValueChange={(v) =>
                        setConvertForm((f) => ({ ...f, departmentId: v, positionId: '' }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Position *</Label>
                    <Select
                      value={convertForm.positionId}
                      onValueChange={(v) => setConvertForm((f) => ({ ...f, positionId: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select position" />
                      </SelectTrigger>
                      <SelectContent>
                        {positions
                          .filter((p) => p.departmentId === convertForm.departmentId)
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Start date</Label>
                  <Input
                    type="date"
                    value={convertForm.startDate}
                    onChange={(e) => setConvertForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConvertDialogFor(null)}>
                  Cancel
                </Button>
                <Button onClick={handleConvert}>
                  <UserPlus className="h-4 w-4" />
                  Create employee
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
