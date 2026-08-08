import { motion } from 'framer-motion';
import {
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Plus,
  Send,
  Users2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/page-header';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useDepartments, usePositions } from '@/data/data-layer';
import { recruitmentRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate } from '@/lib/utils';
import type { JobRequisition, RequisitionStatus } from '@/types';

const statusConfig: Record<RequisitionStatus, { dot: string; badge: string; label: string }> = {
  Draft: {
    dot: 'bg-ink-400',
    badge: 'border-transparent bg-ink-100 text-ink-700',
    label: 'Draft',
  },
  'Pending Approval': {
    dot: 'bg-amber-500',
    badge: 'border-transparent bg-amber-100 text-amber-800',
    label: 'Pending Approval',
  },
  Approved: {
    dot: 'bg-blue-500',
    badge: 'border-transparent bg-blue-100 text-blue-700',
    label: 'Approved',
  },
  Published: {
    dot: 'bg-accent-500',
    badge: 'border-transparent bg-accent-100 text-accent-800',
    label: 'Published',
  },
  Closed: {
    dot: 'bg-ink-500',
    badge: 'border-transparent bg-ink-200 text-ink-700',
    label: 'Closed',
  },
};

const pipelineStages: RequisitionStatus[] = [
  'Draft',
  'Pending Approval',
  'Approved',
  'Published',
  'Closed',
];

interface ReqForm {
  title: string;
  departmentId: string;
  positionId: string;
  headcount: string;
  employmentType: 'Full-time' | 'Part-time' | 'Contract';
  closingDate: string;
}

export function RequisitionsPage() {
  const { hasPermission, employee } = useAuth();
  const isHrOrAdmin = hasPermission('manageRecruitment');
  const canManageDept = hasPermission('manageRecruitmentDept');
  const canCreateReq = isHrOrAdmin || canManageDept;
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const managerDeptId = !isHrOrAdmin && canManageDept && employee ? employee.departmentId : null;
  const [deptFilter, setDeptFilter] = useState<string>(managerDeptId ?? 'all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ReqForm>({
    title: '',
    departmentId: '',
    positionId: '',
    headcount: '1',
    employmentType: 'Full-time',
    closingDate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();

  const load = useCallback(async () => {
    try {
      const list = await recruitmentRepo.listRequisitions();
      setRequisitions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requisitions.');
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

  // Scope stats and filtering to the visible pool (respects role + department filter)
  const visiblePool = useMemo(() => {
    let result = requisitions;
    // Managers are locked to their department
    if (canManageDept && !isHrOrAdmin && employee) {
      result = result.filter((r) => r.departmentId === employee.departmentId);
    }
    // Apply department filter (HR only; for managers this is locked)
    if (deptFilter !== 'all') {
      result = result.filter((r) => r.departmentId === deptFilter);
    }
    return result;
  }, [requisitions, deptFilter, canManageDept, isHrOrAdmin, employee]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return visiblePool;
    return visiblePool.filter((r) => r.status === statusFilter);
  }, [visiblePool, statusFilter]);

  const hasActiveFilters = deptFilter !== 'all' || statusFilter !== 'all';

  const clearFilters = () => {
    setDeptFilter(managerDeptId ?? 'all');
    setStatusFilter('all');
  };

  const stats = useMemo(() => {
    const open = visiblePool.filter(
      (r) => r.status === 'Published' || r.status === 'Approved',
    ).length;
    const pending = visiblePool.filter((r) => r.status === 'Pending Approval').length;
    const applicants = visiblePool.reduce((sum, r) => sum + r.applicantCount, 0);
    const hired = visiblePool.filter((r) => r.status === 'Closed').length;
    return { open, pending, applicants, hired };
  }, [visiblePool]);

  const eligiblePositions = positions.filter((p) => p.departmentId === form.departmentId);

  const openCreate = () => {
    // For Managers, default to their own department
    const defaultDept = canManageDept && !isHrOrAdmin && employee ? employee.departmentId : '';
    setForm({
      title: '',
      departmentId: defaultDept,
      positionId: '',
      headcount: '1',
      employmentType: 'Full-time',
      closingDate: '',
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.title.trim()) {
      setError('Requisition title is required.');
      return;
    }
    if (!form.departmentId) {
      setError('Please select a department.');
      return;
    }
    if (!form.positionId) {
      setError('Please select a position.');
      return;
    }
    const hc = parseInt(form.headcount, 10);
    if (!hc || hc <= 0) {
      setError('Headcount must be a positive number.');
      return;
    }

    // Map display labels to backend enum values
    const employmentTypeMap: Record<ReqForm['employmentType'], string> = {
      'Full-time': 'FULL_TIME',
      'Part-time': 'PART_TIME',
      Contract: 'CONTRACT',
    };

    try {
      await recruitmentRepo.createRequisition({
        title: form.title,
        departmentId: form.departmentId,
        positionId: form.positionId,
        headcount: hc,
        employmentType: employmentTypeMap[form.employmentType],
        closingDate: form.closingDate || undefined,
      });
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create requisition.');
    }
  };

  const advanceStatus = async (req: JobRequisition) => {
    const order: RequisitionStatus[] = pipelineStages;
    const idx = order.indexOf(req.status);
    if (idx < 0 || idx >= order.length - 1) return;
    try {
      switch (req.status) {
        case 'Draft':
          await recruitmentRepo.submitRequisition(req.id);
          break;
        case 'Pending Approval':
          await recruitmentRepo.approveRequisition(req.id);
          break;
        case 'Approved':
          await recruitmentRepo.publishRequisition(req.id);
          break;
        case 'Published':
          await recruitmentRepo.closeRequisition(req.id);
          break;
        default:
          return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance requisition.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Recruitment"
        description="Create job requisitions, track candidates, and manage offers."
        actions={
          canCreateReq && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New requisition
            </Button>
          )
        }
      />

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PipelineCard
          icon={Briefcase}
          label="Open roles"
          value={stats.open}
          tone="accent"
          delay={0}
        />
        <PipelineCard
          icon={Clock}
          label="Pending approval"
          value={stats.pending}
          tone="warning"
          delay={0.05}
        />
        <PipelineCard icon={Users2} label="Total applicants" value={stats.applicants} delay={0.1} />
        <PipelineCard
          icon={CheckCircle2}
          label="Roles filled"
          value={stats.hired}
          tone="accent"
          delay={0.15}
        />
      </div>

      {/* Filter bar */}
      <div className="mt-6 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[180px] text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {pipelineStages.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isHrOrAdmin && (
          <Select value={deptFilter} onValueChange={setDeptFilter}>
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

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Job requisitions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-ink-500">
              Loading requisitions…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No requisitions found"
              description="Create a job requisition to start the hiring process."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-center">Headcount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applicants</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((req, i) => {
                  const cfg = statusConfig[req.status];
                  return (
                    <TableRow key={req.id}>
                      <TableCell>
                        <motion.div
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.25 }}
                        >
                          <Link
                            to={`/app/recruitment/candidates?req=${req.id}`}
                            className="font-medium text-ink-900 transition-colors hover:text-accent-700"
                          >
                            {req.title}
                          </Link>
                          <div className="text-xs text-ink-500">{req.positionName}</div>
                        </motion.div>
                      </TableCell>
                      <TableCell className="text-sm text-ink-600">{req.departmentName}</TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {req.headcount}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {req.employmentType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('gap-1.5', cfg.badge)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {req.applicantCount > 0 ? (
                          <Link
                            to={`/app/recruitment/candidates?req=${req.id}`}
                            className="font-medium text-accent-700 hover:underline"
                          >
                            {req.applicantCount}
                          </Link>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-ink-600">
                        {req.closingDate ? formatDate(req.closingDate) : '—'}
                      </TableCell>
                      <TableCell>
                        {canCreateReq && req.status !== 'Closed' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => advanceStatus(req)}
                            className="text-xs"
                          >
                            Advance
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New job requisition</DialogTitle>
            <DialogDescription>
              Create a requisition to request headcount. It will be routed to HR for approval before
              publishing.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Title *</Label>
              <Input
                id="req-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Senior Frontend Engineer (React)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Department *</Label>
                <Select
                  value={form.departmentId}
                  onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v, positionId: '' }))}
                  disabled={canManageDept && !isHrOrAdmin}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {canManageDept && !isHrOrAdmin && employee
                      ? departments
                          .filter((d) => d.id === employee.departmentId)
                          .map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))
                      : departments.map((d) => (
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
                  value={form.positionId}
                  onValueChange={(v) => setForm((f) => ({ ...f, positionId: v }))}
                  disabled={!form.departmentId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligiblePositions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="req-hc">Headcount *</Label>
                <Input
                  id="req-hc"
                  type="number"
                  min={1}
                  value={form.headcount}
                  onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      employmentType: v as ReqForm['employmentType'],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Full-time">Full-time</SelectItem>
                    <SelectItem value="Part-time">Part-time</SelectItem>
                    <SelectItem value="Contract">Contract</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="req-close">Closing date</Label>
                <Input
                  id="req-close"
                  type="date"
                  value={form.closingDate}
                  onChange={(e) => setForm((f) => ({ ...f, closingDate: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              <Send className="h-4 w-4" />
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline hint */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <p>
          Requisitions follow a 5-stage pipeline: Draft → Pending Approval → Approved → Published →
          Closed. Approved requisitions become internal job postings visible to all employees.
          Candidate PII is retained for a maximum of 12 months if not hired.
        </p>
      </div>
    </div>
  );
}

function PipelineCard({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  delay = 0,
}: {
  icon: typeof Briefcase;
  label: string;
  value: number;
  tone?: 'neutral' | 'accent' | 'warning';
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-3 p-4">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              tone === 'accent' && 'bg-accent-100 text-accent-700',
              tone === 'warning' && 'bg-amber-100 text-amber-600',
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
