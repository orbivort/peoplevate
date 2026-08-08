import { motion } from 'framer-motion';
import { MessageSquareWarning, Plus, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import { createBreach, recordBreachNotification, useBreaches } from '@/data/data-layer';
import { cn, formatDate } from '@/lib/utils';
import type { DataBreach } from '@/types';

const severityStyles: Record<string, string> = {
  HIGH: 'border-transparent bg-red-100 text-red-700',
  MEDIUM: 'border-transparent bg-amber-100 text-amber-800',
  LOW: 'border-transparent bg-blue-100 text-blue-700',
};

const statusStyles: Record<string, string> = {
  OPEN: 'border-transparent bg-red-100 text-red-700',
  CONTAINED: 'border-transparent bg-amber-100 text-amber-800',
  RESOLVED: 'border-transparent bg-blue-100 text-blue-700',
  CLOSED: 'border-transparent bg-accent-100 text-accent-800',
};

const statusOptions = ['all', 'OPEN', 'CONTAINED', 'RESOLVED', 'CLOSED'];

interface BreachFormState {
  title: string;
  description: string;
  detectionAt: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  isHighRisk: boolean;
  dataCategoriesAffected: string;
  affectedSubjectsCount: string;
}

function NotificationDialog({
  breach,
  onClose,
  onSaved,
}: {
  breach: DataBreach | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!breach || !method) return;
    setBusy(true);
    try {
      await recordBreachNotification(breach.id, {
        notificationType: 'SUPERVISORY_AUTHORITY',
        method,
        ...(reference ? { reference } : {}),
      });
      onSaved();
    } catch {
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!breach} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record supervisory authority notification</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-ink-500">
            Record that the supervisory authority was notified for <strong>{breach?.title}</strong>.
            Under GDPR Art. 33, notification must occur within 72 hours of becoming aware of the
            breach.
          </p>
          <div className="space-y-1.5">
            <Label>Notification method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Supervisory authority portal">
                  Supervisory authority portal
                </SelectItem>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="Certified letter">Certified letter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. SA-2026-1201"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !method}>
            {busy ? 'Saving…' : 'Record notification'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BreachRegisterPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageBreach');
  const [statusFilter, setStatusFilter] = useState('all');
  const {
    data: breaches,
    mode,
    reload: reloadBreaches,
  } = useBreaches(statusFilter === 'all' ? undefined : statusFilter);

  const [createOpen, setCreateOpen] = useState(false);
  const [notifyBreach, setNotifyBreach] = useState<DataBreach | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<BreachFormState>({
    title: '',
    description: '',
    detectionAt: new Date().toISOString().slice(0, 10),
    severity: 'MEDIUM',
    isHighRisk: false,
    dataCategoriesAffected: '',
    affectedSubjectsCount: '',
  });

  const pendingNotifications = useMemo(
    () => breaches.filter((b) => b.severity !== 'LOW' && !b.saNotifiedAt),
    [breaches],
  );

  async function handleCreate() {
    if (!form.title || !form.description) return;
    setBusy(true);
    try {
      await createBreach({
        title: form.title,
        description: form.description,
        detectionAt: new Date(form.detectionAt).toISOString(),
        severity: form.severity,
        isHighRisk: form.isHighRisk,
        dataCategoriesAffected: form.dataCategoriesAffected
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        affectedSubjectsCount: Number(form.affectedSubjectsCount) || 0,
      });
      setFeedback('Breach recorded.');
      reloadBreaches();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to record breach.');
    } finally {
      setCreateOpen(false);
      setForm({
        title: '',
        description: '',
        detectionAt: new Date().toISOString().slice(0, 10),
        severity: 'MEDIUM',
        isHighRisk: false,
        dataCategoriesAffected: '',
        affectedSubjectsCount: '',
      });
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Breach register"
        description="Central log of personal-data breaches and supervisory-authority notifications."
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Log breach
            </Button>
          ) : undefined
        }
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

      {pendingNotifications.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>{pendingNotifications.length} breach(es)</strong> require supervisory-authority
            notification within 72 hours of detection. Select a breach and record the notification.
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All statuses' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-ink-500">
          {breaches.length} {breaches.length === 1 ? 'breach' : 'breaches'}
        </div>
      </div>

      <Card>
        {breaches.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No breaches logged"
            description="When a breach is detected, log it here to start the containment and notification workflow."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Breach</TableHead>
                <TableHead className="w-[100px]">Severity</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[120px]">Subjects</TableHead>
                <TableHead className="w-[130px]">Detected</TableHead>
                <TableHead className="w-[150px]">SA notification</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {breaches.map((breach, i) => {
                const saOverdue =
                  breach.severity === 'HIGH' &&
                  !breach.saNotifiedAt &&
                  new Date(breach.saNotificationDeadline) < new Date();
                return (
                  <motion.tr
                    key={breach.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.2 }}
                    className="group border-b border-ink-200 transition-colors hover:bg-ink-50/60"
                  >
                    <TableCell>
                      <div className="text-sm font-medium text-ink-900">{breach.title}</div>
                      <div className="mt-0.5 line-clamp-1 max-w-[280px] text-xs text-ink-500">
                        {breach.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn('font-mono text-[10px]', severityStyles[breach.severity])}
                      >
                        {breach.severity}
                        {breach.isHighRisk && ' · HIGH RISK'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-[10px]', statusStyles[breach.containmentStatus])}>
                        {breach.containmentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-ink-700">{breach.affectedSubjectsCount}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-ink-500">{formatDate(breach.detectionAt)}</span>
                    </TableCell>
                    <TableCell>
                      {breach.saNotifiedAt ? (
                        <span className="text-xs text-accent-700">
                          Notified {formatDate(breach.saNotifiedAt)}
                        </span>
                      ) : breach.severity !== 'LOW' ? (
                        <span
                          className={cn(
                            'text-xs',
                            saOverdue ? 'font-medium text-red-600' : 'text-amber-600',
                          )}
                        >
                          {saOverdue
                            ? 'Overdue'
                            : 'Due ' + formatDate(breach.saNotificationDeadline)}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">Not required</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && breach.severity !== 'LOW' && !breach.saNotifiedAt && (
                        <Button variant="outline" size="sm" onClick={() => setNotifyBreach(breach)}>
                          <MessageSquareWarning className="text-amber-600" />
                          Notify
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

      {/* Create breach dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log a personal-data breach</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Short summary of the incident"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What happened, what data was involved, who was affected"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Detection date</Label>
                <Input
                  type="date"
                  value={form.detectionAt}
                  onChange={(e) => setForm((f) => ({ ...f, detectionAt: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, severity: v as BreachFormState['severity'] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Data categories affected (comma-separated)</Label>
              <Input
                value={form.dataCategoriesAffected}
                onChange={(e) => setForm((f) => ({ ...f, dataCategoriesAffected: e.target.value }))}
                placeholder="SALARY_RECORDS, NATIONAL_ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Affected data subjects</Label>
              <Input
                type="number"
                min={0}
                value={form.affectedSubjectsCount}
                onChange={(e) => setForm((f) => ({ ...f, affectedSubjectsCount: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={form.isHighRisk}
                onChange={(e) => setForm((f) => ({ ...f, isHighRisk: e.target.checked }))}
                className="h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-500"
              />
              High risk to rights and freedoms of individuals
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy ? 'Saving…' : 'Log breach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NotificationDialog
        breach={notifyBreach}
        onClose={() => setNotifyBreach(null)}
        onSaved={() => {
          setNotifyBreach(null);
          setFeedback('Supervisory authority notification recorded.');
          reloadBreaches();
        }}
      />
    </div>
  );
}
