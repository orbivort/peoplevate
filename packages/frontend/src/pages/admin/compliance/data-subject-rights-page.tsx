import { motion } from 'framer-motion';
import {
  AlertOctagon,
  DatabaseZap,
  Download,
  FileArchive,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import {
  dismissAnomaly,
  requestDataAccess,
  requestDataErasure,
  requestDataExport,
  useAnomalyAlerts,
  useUsers,
} from '@/data/data-layer';
import { cn, formatDate } from '@/lib/utils';

export function DataSubjectRightsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageDsar');
  const { data: alerts, mode, reload: reloadAlerts } = useAnomalyAlerts();
  const { data: users } = useUsers();

  const [subjectInput, setSubjectInput] = useState('');
  const [accessDialog, setAccessDialog] = useState(false);
  const [erasureDialog, setErasureDialog] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matchedUser = users.find(
    (u) => u.id === subjectInput || u.email?.toLowerCase() === subjectInput.toLowerCase(),
  );

  async function handleAccess() {
    if (!matchedUser) return;
    setBusy(true);
    try {
      await requestDataAccess(matchedUser.id);
      setFeedback(`Access request initiated for ${matchedUser.email}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Access request failed.');
    } finally {
      setAccessDialog(false);
      setBusy(false);
    }
  }

  async function handleExport() {
    if (!matchedUser) return;
    setBusy(true);
    try {
      await requestDataExport(matchedUser.id, 'json');
      setFeedback(`Portability export (JSON) downloaded for ${matchedUser.email}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setAccessDialog(false);
      setBusy(false);
    }
  }

  async function handleErasure() {
    if (!matchedUser) return;
    setBusy(true);
    try {
      await requestDataErasure(matchedUser.id);
      setFeedback(`Erasure (right to be forgotten) initiated for ${matchedUser.email}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erasure request failed.');
    } finally {
      setErasureDialog(false);
      setBusy(false);
    }
  }

  async function handleDismiss(alertId: string, reason: string) {
    try {
      await dismissAnomaly(alertId, reason);
      reloadAlerts();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to dismiss alert.');
    }
  }

  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  return (
    <div>
      <PageHeader
        title="Data subject rights"
        description="Exercise Art. 15–20 rights (access, export, erasure) for a subject and review anomaly alerts."
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

      {/* Subject lookup */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Label htmlFor="subject">Data subject</Label>
            <Input
              id="subject"
              placeholder="Search by user ID or email…"
              value={subjectInput}
              onChange={(e) => setSubjectInput(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div className="flex items-end gap-2 pt-5">
            <Button
              variant="outline"
              disabled={!matchedUser || !canManage}
              onClick={() => setAccessDialog(true)}
            >
              <FileArchive className="text-accent-600" />
              Access / export
            </Button>
            <Button
              variant="danger"
              disabled={!matchedUser || !canManage}
              onClick={() => setErasureDialog(true)}
            >
              <Trash2 className="text-white" />
              Erase
            </Button>
          </div>
        </div>
        {matchedUser ? (
          <div className="mt-3 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-700">
            Selected: <strong>{matchedUser.email}</strong> ({matchedUser.role})
          </div>
        ) : subjectInput ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No user matches “{subjectInput}”.
          </div>
        ) : null}
      </Card>

      {/* Anomaly alerts */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-base font-semibold text-ink-900">Anomaly alerts</h2>
        {openAlerts.length > 0 && <Badge variant="danger">{openAlerts.length} open</Badge>}
      </div>
      <Card>
        {alerts.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No anomaly alerts"
            description="Suspicious access patterns (e.g. bulk downloads, login spikes) will appear here."
          />
        ) : (
          <div className="divide-y divide-ink-200">
            {alerts.map((alert, i) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02, duration: 0.2 }}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-ink-50/60"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'rounded-lg p-2',
                      alert.severity === 'HIGH'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-amber-100 text-amber-700',
                    )}
                  >
                    <AlertOctagon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-ink-900">
                      {alert.alertType.replace(/_/g, ' ')}
                    </div>
                    <div className="text-xs text-ink-500">
                      {alert.entityType} {alert.entityId} · detected {formatDate(alert.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {alert.status === 'OPEN' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleDismiss(alert.id, 'Reviewed and dismissed by compliance.')
                      }
                    >
                      <UserCog className="text-ink-500" />
                      Dismiss
                    </Button>
                  )}
                  <Badge
                    className={cn(
                      'text-[10px]',
                      alert.status === 'OPEN'
                        ? 'border-transparent bg-amber-100 text-amber-800'
                        : 'border-transparent bg-ink-100 text-ink-600',
                    )}
                  >
                    {alert.status}
                  </Badge>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
        <p>
          Anomaly detection flags high-risk access patterns. Dismissing an alert records the
          reviewer and reason in the audit log. Erasure performs a soft-delete and schedules hard
          deletion per the retention schedule — the audit trail is preserved.
        </p>
      </div>

      {/* Access / export dialog */}
      <Dialog open={accessDialog} onOpenChange={setAccessDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Data access &amp; portability</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              For <strong>{matchedUser?.email}</strong>, you can compile an access report (Art. 15)
              or an exportable, machine-readable copy (Art. 20).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" onClick={handleAccess} disabled={busy}>
                <FileArchive className="text-accent-600" />
                Compile access report
              </Button>
              <Button variant="outline" onClick={handleExport} disabled={busy}>
                <Download className="text-accent-600" />
                Export (JSON)
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAccessDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Erasure dialog */}
      <Dialog open={erasureDialog} onOpenChange={setErasureDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Right to be forgotten (Art. 17)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Initiate erasure for <strong>{matchedUser?.email}</strong>. The account is deactivated
              immediately; personal data is hard-deleted according to the retention schedule.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>This cannot be undone. The audit trail of the deletion itself is preserved.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErasureDialog(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleErasure} disabled={busy}>
              {busy ? 'Processing…' : 'Confirm erasure'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
