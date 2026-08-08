import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, Clock, Database, ShieldCheck, Trash2 } from 'lucide-react';
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
import { runRetentionPurge, upsertRetentionPolicy, useRetentionPolicies } from '@/data/data-layer';
import { cn, formatDate } from '@/lib/utils';

const categoryLabels: Record<string, string> = {
  TERMINATED_EMPLOYEE_RECORDS: 'Terminated employee records',
  CANDIDATE_RESUMES: 'Candidate resumes',
  CONTRACTS: 'Employment contracts',
  ATTENDANCE_RECORDS: 'Attendance records',
  LEAVE_RECORDS: 'Leave records',
  SALARY_RECORDS: 'Salary records',
  AUDIT_LOGS: 'Audit logs',
  MEDICAL_RECORDS: 'Medical records',
};

const actionStyles: Record<string, string> = {
  HARD_DELETE: 'border-transparent bg-red-100 text-red-700',
  ANONYMIZE: 'border-transparent bg-blue-100 text-blue-700',
};

interface PolicyFormState {
  dataCategory: string;
  retentionYears: string;
  action: 'HARD_DELETE' | 'ANONYMIZE';
  description: string;
}

export function RetentionPoliciesPage() {
  const { hasPermission } = useAuth();
  const { data: policies, mode, reload: reloadPolicies } = useRetentionPolicies();
  const canManage = hasPermission('manageRetention');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDryRun, setPurgeDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [form, setForm] = useState<PolicyFormState>({
    dataCategory: '',
    retentionYears: '',
    action: 'HARD_DELETE',
    description: '',
  });

  const editTarget = useMemo(() => {
    return policies.find((p) => p.dataCategory === form.dataCategory) ?? null;
  }, [form.dataCategory, policies]);

  function resetForm() {
    setForm({ dataCategory: '', retentionYears: '', action: 'HARD_DELETE', description: '' });
  }

  async function handleSave() {
    if (!form.dataCategory || !form.retentionYears) return;
    setBusy(true);
    try {
      await upsertRetentionPolicy({
        dataCategory: form.dataCategory,
        retentionYears: Number(form.retentionYears),
        action: form.action,
        ...(form.description ? { description: form.description } : {}),
      });
      setFeedback('Retention policy saved.');
      resetForm();
      reloadPolicies();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to save policy.');
    } finally {
      setDialogOpen(false);
      setBusy(false);
    }
  }

  async function handlePurge() {
    setBusy(true);
    try {
      await runRetentionPurge(purgeDryRun);
      setFeedback(purgeDryRun ? 'Dry run completed — no data was deleted.' : 'Purge completed.');
      reloadPolicies();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Purge failed.');
    } finally {
      setPurgeOpen(false);
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Data retention"
        description="Policies governing how long each category of personal data is kept, and the action taken once it expires."
        actions={
          canManage ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setPurgeDryRun(true);
                  setPurgeOpen(true);
                }}
              >
                <AlertTriangle className="text-amber-600" />
                Dry run purge
              </Button>
              <Button
                onClick={() => {
                  setForm({
                    dataCategory: 'CANDIDATE_RESUMES',
                    retentionYears: '2',
                    action: 'ANONYMIZE',
                    description: '',
                  });
                  setDialogOpen(true);
                }}
              >
                Edit policy
              </Button>
            </>
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

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-100 p-2 text-accent-700">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-ink-900">{policies.length}</div>
              <div className="text-xs text-ink-500">Policy categories</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-ink-900">
                {policies.reduce((acc, p) => Math.max(acc, p.retentionYears), 0)}y
              </div>
              <div className="text-xs text-ink-500">Longest retention</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2 text-green-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-ink-900">
                {policies.filter((p) => p.action === 'HARD_DELETE').length}
              </div>
              <div className="text-xs text-ink-500">Hard-delete categories</div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        {policies.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No retention policies"
            description="Add a retention policy to start governing data lifecycle."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data category</TableHead>
                <TableHead className="w-[140px]">Retention</TableHead>
                <TableHead className="w-[140px]">Action on expiry</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[120px]">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((policy, i) => (
                <motion.tr
                  key={policy.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                  className="group border-b border-ink-200 transition-colors hover:bg-ink-50/60"
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-ink-900">
                        {categoryLabels[policy.dataCategory] ?? policy.dataCategory}
                      </div>
                      {policy.isDefault && <Badge variant="secondary">default</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-ink-700">
                      <CalendarClock className="h-4 w-4 text-ink-400" />
                      {policy.retentionYears} years
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('font-mono text-[10px]', actionStyles[policy.action])}>
                      {policy.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-ink-600">{policy.description ?? '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-ink-500">{formatDate(policy.updatedAt)}</span>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
        <p>
          Expired records are processed by a scheduled job (default daily). Hard-delete removes the
          row permanently and writes an audit entry; anonymize replaces identifying fields with
          placeholders so the record remains for aggregate analysis. Legal holds temporarily
          override deletion for records under active litigation.
        </p>
      </div>

      {/* Edit policy dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editTarget ? 'Edit retention policy' : 'New retention policy'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Data category</Label>
              <Select
                value={form.dataCategory}
                onValueChange={(v) => {
                  const existing = policies.find((p) => p.dataCategory === v);
                  setForm((f) => ({
                    ...f,
                    dataCategory: v,
                    retentionYears: existing ? String(existing.retentionYears) : f.retentionYears,
                    action: (existing?.action as 'HARD_DELETE' | 'ANONYMIZE') ?? f.action,
                    description: existing?.description ?? f.description,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Retention (years)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.retentionYears}
                  onChange={(e) => setForm((f) => ({ ...f, retentionYears: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Action on expiry</Label>
                <Select
                  value={form.action}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, action: v as 'HARD_DELETE' | 'ANONYMIZE' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HARD_DELETE">Hard delete</SelectItem>
                    <SelectItem value="ANONYMIZE">Anonymize</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional note on the legal basis or rationale"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {busy ? 'Saving…' : 'Save policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purge dialog */}
      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run retention purge</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Running in <strong>dry run</strong> mode reports the records that are eligible for
              processing without modifying any data. Switch off dry run to execute the purge for
              real.
            </p>
            <div className="flex items-center gap-2">
              <input
                id="dry-run"
                type="checkbox"
                checked={purgeDryRun}
                onChange={(e) => setPurgeDryRun(e.target.checked)}
                className="h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-500"
              />
              <Label htmlFor="dry-run">Dry run (no data deleted)</Label>
            </div>
            {!purgeDryRun && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  This permanently deletes expired records and writes audit entries. This cannot be
                  undone.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={purgeDryRun ? 'default' : 'danger'}
              onClick={handlePurge}
              disabled={busy}
            >
              {busy ? 'Running…' : purgeDryRun ? 'Run dry run' : 'Execute purge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
