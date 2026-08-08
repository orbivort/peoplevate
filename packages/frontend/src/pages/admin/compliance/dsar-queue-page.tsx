import { motion } from 'framer-motion';
import { FileSearch, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
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
import { updateDsarStatus, useDsars } from '@/data/data-layer';
import { cn, formatDate } from '@/lib/utils';
import type { DataSubjectAccessRequest } from '@/types';

const typeLabels: Record<string, string> = {
  ACCESS: 'Access',
  ERASURE: 'Erasure',
  PORTABILITY: 'Portability',
  RECTIFICATION: 'Rectification',
};

const statusStyles: Record<string, string> = {
  PENDING_VERIFICATION: 'border-transparent bg-amber-100 text-amber-800',
  VERIFIED: 'border-transparent bg-blue-100 text-blue-700',
  IN_PROGRESS: 'border-transparent bg-accent-100 text-accent-800',
  COMPLETED: 'border-transparent bg-green-100 text-green-700',
  REJECTED: 'border-transparent bg-red-100 text-red-700',
};

const statusOptions = [
  'all',
  'PENDING_VERIFICATION',
  'VERIFIED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
];

export function DsarQueuePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageDsar');
  const [statusFilter, setStatusFilter] = useState('all');
  const {
    data: dsars,
    mode,
    reload: reloadDsars,
  } = useDsars(statusFilter === 'all' ? undefined : statusFilter);

  const [selected, setSelected] = useState<DataSubjectAccessRequest | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleStatusChange() {
    if (!selected || !newStatus) return;
    setBusy(true);
    try {
      await updateDsarStatus(selected.id, {
        status: newStatus,
        ...(newStatus === 'REJECTED' && rejectionReason ? { rejectionReason } : {}),
      });
      setFeedback(`DSAR ${selected.requestType} moved to ${newStatus}.`);
      reloadDsars();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to update DSAR.');
    } finally {
      setSelected(null);
      setNewStatus('');
      setRejectionReason('');
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Data subject requests"
        description="Queue of access, erasure, portability and rectification requests. Under GDPR these must be fulfilled within one month (30 days)."
      />

      {feedback && (
        <div className="mb-4 rounded-lg border border-ink-200 bg-white p-3 text-sm text-ink-700">
          {feedback}
        </div>
      )}
      {mode === 'fallback' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Backend unavailable — showing demo data.
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-ink-500">
          {dsars.length} {dsars.length === 1 ? 'request' : 'requests'}
        </div>
      </div>

      <Card>
        {dsars.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No data subject requests"
            description="New requests submitted by data subjects will appear here for verification and fulfillment."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead className="w-[120px]">Request type</TableHead>
                <TableHead className="w-[150px]">Status</TableHead>
                <TableHead className="w-[120px]">Received</TableHead>
                <TableHead className="w-[130px]">SLA deadline</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {dsars.map((dsar, i) => {
                const overdue =
                  dsar.slaDeadline &&
                  dsar.status !== 'COMPLETED' &&
                  dsar.status !== 'REJECTED' &&
                  new Date(dsar.slaDeadline) < new Date();
                return (
                  <motion.tr
                    key={dsar.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.2 }}
                    className="group border-b border-ink-200 transition-colors hover:bg-ink-50/60"
                  >
                    <TableCell>
                      <div className="text-sm font-medium text-ink-900">
                        {dsar.dataSubjectEmail}
                      </div>
                      <div className="mt-0.5 line-clamp-1 max-w-[240px] text-xs text-ink-500">
                        {dsar.description ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {typeLabels[dsar.requestType] ?? dsar.requestType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-[10px]', statusStyles[dsar.status])}>
                        {dsar.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-ink-500">{formatDate(dsar.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      {dsar.slaDeadline ? (
                        <span
                          className={cn(
                            'text-xs',
                            overdue ? 'font-medium text-red-600' : 'text-ink-500',
                          )}
                        >
                          {overdue ? 'Overdue ' : ''}
                          {formatDate(dsar.slaDeadline)}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && dsar.status !== 'COMPLETED' && (
                        <Button variant="outline" size="sm" onClick={() => setSelected(dsar)}>
                          <UserRoundCheck className="text-accent-600" />
                          Update
                        </Button>
                      )}
                    </TableCell>
                  </motion.tr>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update DSAR status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
              <div className="text-sm font-medium text-ink-900">{selected?.dataSubjectEmail}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                <Badge variant="secondary">{typeLabels[selected?.requestType ?? '']}</Badge>
                <span>{selected?.description}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>New status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VERIFIED">Verified</SelectItem>
                  <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newStatus === 'REJECTED' && (
              <div className="space-y-1.5">
                <Label>Rejection reason</Label>
                <textarea
                  className="min-h-[70px] w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. identity could not be verified"
                />
              </div>
            )}
            {newStatus === 'COMPLETED' && (
              <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Fulfill the request via the data-subject action before marking complete. A record
                  is written to the audit log.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button onClick={handleStatusChange} disabled={busy || !newStatus}>
              {busy ? 'Saving…' : 'Update status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
