import { motion } from 'framer-motion';
import { Check, FileText, Plus, Send, Trash2, X, XCircle } from 'lucide-react';
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
import { cn, formatDate } from '@/lib/utils';
import type { Candidate, JobRequisition, OfferLetter, OfferStatus } from '@/types';

const statusStyles: Record<OfferStatus, string> = {
  Draft: 'bg-ink-100 text-ink-700',
  Sent: 'bg-blue-100 text-blue-700',
  Accepted: 'bg-accent-100 text-accent-800',
  Declined: 'bg-red-100 text-red-700',
};

interface OfferForm {
  candidateId: string;
  position: string;
  salary: string;
  startDate: string;
  notes: string;
}

export function OffersPage() {
  const { hasPermission } = useAuth();
  // Offer Letters are HR-only: only HR/Admin can view, draft, send and manage offers.
  const isHrOrAdmin = hasPermission('manageRecruitment');
  const canViewOffers = isHrOrAdmin;
  const [offers, setOffers] = useState<OfferLetter[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobRequisitions, setJobRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [reqFilter, setReqFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<OfferForm>({
    candidateId: '',
    position: '',
    salary: '',
    startDate: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: departments } = useDepartments();

  const load = useCallback(async () => {
    try {
      const [offerList, cands, reqs] = await Promise.all([
        recruitmentRepo.listOffers(),
        recruitmentRepo.listCandidates(),
        recruitmentRepo.listRequisitions(),
      ]);
      setOffers(offerList);
      setCandidates(cands);
      setJobRequisitions(reqs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load offers.');
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
    return reqs;
  }, [deptFilter, jobRequisitions]);

  // Apply filters (department, requisition, status)
  const visiblePool = useMemo(() => {
    let result = offers;
    // Apply department filter
    if (deptFilter !== 'all') {
      const deptReqIds = new Set(
        jobRequisitions.filter((r) => r.departmentId === deptFilter).map((r) => r.id),
      );
      const deptCandidateIds = new Set(
        candidates.filter((c) => deptReqIds.has(c.requisitionId)).map((c) => c.id),
      );
      result = result.filter((o) => deptCandidateIds.has(o.candidateId));
    }
    // Apply requisition filter
    if (reqFilter !== 'all') {
      const reqCandidateIds = new Set(
        candidates.filter((c) => c.requisitionId === reqFilter).map((c) => c.id),
      );
      result = result.filter((o) => reqCandidateIds.has(o.candidateId));
    }
    return result;
  }, [offers, candidates, jobRequisitions, deptFilter, reqFilter]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return visiblePool;
    return visiblePool.filter((o) => o.status === statusFilter);
  }, [visiblePool, statusFilter]);

  const hasActiveFilters = deptFilter !== 'all' || reqFilter !== 'all' || statusFilter !== 'all';

  const clearFilters = () => {
    setDeptFilter('all');
    setReqFilter('all');
    setStatusFilter('all');
  };

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [filtered],
  );

  const updateStatus = async (id: string, status: OfferStatus) => {
    try {
      if (status === 'Sent') {
        await recruitmentRepo.sendOffer(id);
      } else if (status === 'Accepted') {
        await recruitmentRepo.acceptOffer(id);
      } else {
        // Declined/other statuses have no dedicated backend endpoint; update locally.
      }
      const now = new Date().toISOString();
      setOffers((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          return {
            ...o,
            status,
            sentAt: status === 'Sent' && !o.sentAt ? now : o.sentAt,
            acceptedAt: status === 'Accepted' ? now : o.acceptedAt,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update offer.');
    }
  };

  const removeOffer = async (id: string) => {
    try {
      await recruitmentRepo.deleteOffer(id);
      setOffers((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete offer.');
    }
  };

  const openCreate = () => {
    setForm({ candidateId: '', position: '', salary: '', startDate: '', notes: '' });
    setError(null);
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    setError(null);
    if (!form.candidateId) {
      setError('Please select a candidate.');
      return;
    }
    if (!form.position.trim()) {
      setError('Position is required.');
      return;
    }
    try {
      await recruitmentRepo.createOffer(form.candidateId, {
        position: form.position,
        salary: Number(form.salary) || 0,
        startDate: form.startDate || new Date().toISOString().slice(0, 10),
        terms: form.notes || undefined,
      });
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create offer.');
    }
  };

  const counts = {
    all: visiblePool.length,
    Draft: visiblePool.filter((o) => o.status === 'Draft').length,
    Sent: visiblePool.filter((o) => o.status === 'Sent').length,
    Accepted: visiblePool.filter((o) => o.status === 'Accepted').length,
    Declined: visiblePool.filter((o) => o.status === 'Declined').length,
  };

  return (
    <div>
      <PageHeader
        title="Offer Letters"
        description="Draft, send, and track offer letters for candidates in the offer stage. Only HR can send and manage offers."
        actions={
          canViewOffers && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Create offer
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
        {(['all', 'Draft', 'Sent', 'Accepted', 'Declined'] as const).map((s) => (
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
            Loading offer letters…
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No offer letters"
            description="Create an offer letter for a candidate who has reached the offer stage."
            action={
              canViewOffers ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Create offer
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
                  <TableHead>Salary</TableHead>
                  <TableHead>Start date</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((offer, i) => (
                  <motion.tr
                    key={offer.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className="group"
                  >
                    <TableCell className="font-medium text-ink-900">
                      {offer.candidateName}
                    </TableCell>
                    <TableCell className="text-sm text-ink-600">{offer.position}</TableCell>
                    <TableCell className="font-mono text-sm text-ink-700">
                      ${offer.salary.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-ink-600">
                      {formatDate(offer.startDate)}
                    </TableCell>
                    <TableCell className="text-sm text-ink-500">
                      {formatDate(offer.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm text-ink-500">
                      {offer.sentAt ? formatDate(offer.sentAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn('border-transparent text-[10px]', statusStyles[offer.status])}
                      >
                        {offer.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {/* Send offer — HR/Admin only (FR-011) */}
                        {offer.status === 'Draft' && isHrOrAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(offer.id, 'Sent')}
                            title="Send offer"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Send
                          </Button>
                        )}
                        {/* Accept/Decline — HR/Admin only */}
                        {offer.status === 'Sent' && isHrOrAdmin && (
                          <>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-accent-600 hover:text-accent-700"
                              onClick={() => updateStatus(offer.id, 'Accepted')}
                              title="Mark accepted"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-red-400 hover:text-red-600"
                              onClick={() => updateStatus(offer.id, 'Declined')}
                              title="Mark declined"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {/* Delete — HR/Admin only */}
                        {isHrOrAdmin && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-ink-400 hover:text-red-600"
                            onClick={() => removeOffer(offer.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create offer dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create offer letter</DialogTitle>
            <DialogDescription>
              Draft an offer for a candidate. You can send it after review.
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
                onValueChange={(v) => {
                  const cand = candidates.find((c) => c.id === v);
                  setForm((f) => ({
                    ...f,
                    candidateId: v,
                    position: cand?.requisitionTitle ?? '',
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a candidate" />
                </SelectTrigger>
                <SelectContent>
                  {candidates
                    .filter((c) => c.stage === 'Offer' || c.stage === 'Interview')
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
                <Label>Position *</Label>
                <Input
                  value={form.position}
                  onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                  placeholder="e.g. Senior Frontend Engineer"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Annual salary ($)</Label>
                <Input
                  type="number"
                  value={form.salary}
                  onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))}
                  placeholder="95000"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={handleCreate}>
              <FileText className="h-4 w-4" />
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
