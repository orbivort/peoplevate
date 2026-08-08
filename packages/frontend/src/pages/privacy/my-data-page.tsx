import {
  Download,
  FileArchive,
  FileCheck2,
  HelpCircle,
  Lock,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import {
  createDsar,
  requestDataAccess,
  requestDataErasure,
  requestDataExport,
  useConsentRecords,
  withdrawConsent,
} from '@/data/data-layer';
import { formatDate } from '@/lib/utils';
import type { ConsentRecord } from '@/types';

const dsarTypeOptions = [
  {
    value: 'ACCESS',
    label: 'Access (Art. 15)',
    hint: 'A copy of the personal data we hold about you.',
  },
  {
    value: 'PORTABILITY',
    label: 'Portability (Art. 20)',
    hint: 'Your data in a machine-readable format.',
  },
  {
    value: 'RECTIFICATION',
    label: 'Rectification (Art. 16)',
    hint: 'Correct inaccurate personal data.',
  },
  { value: 'ERASURE', label: 'Erasure (Art. 17)', hint: 'Request deletion of your personal data.' },
];

const purposeLabels: Record<string, string> = {
  'employee-data-processing': 'Employee data processing',
  'candidate-recruitment': 'Candidate recruitment',
  'performance-management': 'Performance management',
  payroll: 'Payroll administration',
};

export function MyDataPage() {
  const { user, employee } = useAuth();
  const userEmail = user?.email ?? employee?.email ?? '';
  const { data: consents, reload: reloadConsents } = useConsentRecords({
    dataSubjectEmail: userEmail,
  });

  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Export
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('json');

  // DSAR form
  const [dsarOpen, setDsarOpen] = useState(false);
  const [dsarType, setDsarType] = useState('ACCESS');
  const [dsarDescription, setDsarDescription] = useState('');

  // Erasure
  const [erasureOpen, setErasureOpen] = useState(false);

  // Consent withdrawal
  const [withdrawTarget, setWithdrawTarget] = useState<ConsentRecord | null>(null);

  if (!user) return null;

  const isPrivileged = user?.role === 'Admin' || user?.role === 'HR Manager';

  async function handleExport() {
    if (!user) return;
    setBusy(true);
    try {
      await requestDataExport(user.id, exportFormat as 'json' | 'csv');
      setFeedback(`Portability export (${exportFormat.toUpperCase()}) has been downloaded.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Export request failed.');
    } finally {
      setExportOpen(false);
      setBusy(false);
    }
  }

  async function handleAccess() {
    if (!user) return;
    setBusy(true);
    try {
      await requestDataAccess(user.id);
      setFeedback(`An access report for ${userEmail} has been initiated.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Access request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitDsar() {
    setBusy(true);
    try {
      await createDsar({
        requestType: dsarType,
        dataSubjectEmail: userEmail,
        ...(dsarDescription ? { description: dsarDescription } : {}),
      });
      setFeedback('Your data subject request has been submitted. We will respond within 30 days.');
      setDsarDescription('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to submit request.');
    } finally {
      setDsarOpen(false);
      setBusy(false);
    }
  }

  async function handleErasure() {
    if (!user) return;
    // Only Admin/HR can execute erasure directly; everyone else must submit a
    // DSAR that the team verifies and processes.
    if (!isPrivileged) {
      setErasureOpen(false);
      setDsarType('ERASURE');
      setDsarOpen(true);
      return;
    }
    setBusy(true);
    try {
      await requestDataErasure(user.id);
      setFeedback('Erasure request submitted. Our team will verify your identity and process it.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erasure request failed.');
    } finally {
      setErasureOpen(false);
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!withdrawTarget) return;
    setBusy(true);
    try {
      await withdrawConsent(withdrawTarget.id);
      setFeedback('Consent withdrawn. Processing for this purpose will stop.');
      reloadConsents();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to withdraw consent.');
    } finally {
      setWithdrawTarget(null);
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="My data & privacy"
        description="Exercise your rights under the GDPR: access, export, rectification, erasure, and consent management."
      />

      {feedback && (
        <div className="mb-4 rounded-lg border border-ink-200 bg-white p-3 text-sm text-ink-700">
          {feedback}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Access & export */}
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-100 p-2 text-accent-700">
              <FileArchive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">
                Access &amp; portability
              </h3>
              <p className="text-xs text-ink-500">Art. 15 &amp; 20</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-600">
            Request a copy of all personal data we hold about you, or an exportable,
            machine-readable copy for use elsewhere.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleAccess} disabled={busy}>
              <UserRoundCheck className="text-accent-600" />
              Request access report
            </Button>
            <Button variant="outline" onClick={() => setExportOpen(true)} disabled={busy}>
              <Download className="text-accent-600" />
              Export my data
            </Button>
          </div>
        </Card>

        {/* Erasure */}
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-100 p-2 text-red-700">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">
                Right to erasure
              </h3>
              <p className="text-xs text-ink-500">Art. 17 — “right to be forgotten”</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-600">
            Ask us to delete your personal data where there is no longer a lawful basis to keep it.
          </p>
          <div className="mt-4">
            <Button variant="danger" onClick={() => setErasureOpen(true)} disabled={busy}>
              <Trash2 className="text-white" />
              Request erasure
            </Button>
          </div>
        </Card>

        {/* Submit a request */}
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">
                Submit a data request
              </h3>
              <p className="text-xs text-ink-500">Art. 15–18</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-600">
            File a formal data subject request. We confirm receipt and respond within one month.
          </p>
          <div className="mt-4">
            <Button onClick={() => setDsarOpen(true)} disabled={busy}>
              <HelpCircle className="h-4 w-4" />
              Start a request
            </Button>
          </div>
        </Card>

        {/* Consent */}
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2 text-green-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">Your consent</h3>
              <p className="text-xs text-ink-500">Records of consent you have given</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {consents.length === 0 ? (
              <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-500">
                No consent records found.
              </div>
            ) : (
              consents.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-ink-900">
                      {purposeLabels[c.processingPurpose] ?? c.processingPurpose}
                    </div>
                    <div className="text-xs text-ink-500">
                      {formatDate(c.recordedAt)} · <Badge variant="secondary">{c.mechanism}</Badge>
                    </div>
                  </div>
                  {c.status === 'GIVEN' ? (
                    <Button variant="outline" size="sm" onClick={() => setWithdrawTarget(c)}>
                      Withdraw
                    </Button>
                  ) : (
                    <Badge className="border-transparent bg-red-100 text-red-700">Withdrawn</Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
        <p>
          All requests are logged with a unique reference and audited. Sensitive fields (national
          ID, salary) are encrypted at rest and only decrypted for the requester after identity
          verification. We never sell or share your data with third parties.
        </p>
      </div>

      {/* Export dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export my data</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Choose a format for your portable copy of {userEmail}. JSON is the most
              machine-readable; CSV is convenient for spreadsheets.
            </p>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={busy}>
              {busy ? 'Preparing…' : 'Export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DSAR form dialog */}
      <Dialog open={dsarOpen} onOpenChange={setDsarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit a data subject request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Request type</Label>
              <Select value={dsarType} onValueChange={setDsarType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dsarTypeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Details (optional)</Label>
              <textarea
                className="min-h-[90px] w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
                value={dsarDescription}
                onChange={(e) => setDsarDescription(e.target.value)}
                placeholder="Describe what you need"
              />
            </div>
            <p className="text-xs text-ink-500">
              We will verify your identity and respond within 30 days of receipt.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDsarOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitDsar} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Erasure dialog */}
      <Dialog open={erasureOpen} onOpenChange={setErasureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request erasure of your data</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Under Article 17 you may request deletion of your personal data. We will verify your
              identity before processing. Some data may be retained where required by law (e.g. tax
              and employment records).
            </p>
            {isPrivileged ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  As an admin/HR user, confirming will erase the target data directly. Your account
                  will be deactivated and your personal data scheduled for deletion.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Continue to submit an erasure request. Our team will verify your identity and
                  process it before any data is deleted.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErasureOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleErasure} disabled={busy}>
              {isPrivileged ? (busy ? 'Erasing…' : 'Confirm erasure') : 'Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw consent dialog */}
      <Dialog open={!!withdrawTarget} onOpenChange={(open) => !open && setWithdrawTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw consent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Withdraw your consent for{' '}
              <strong>
                {withdrawTarget
                  ? (purposeLabels[withdrawTarget.processingPurpose] ??
                    withdrawTarget.processingPurpose)
                  : ''}
              </strong>
              .
            </p>
            <p className="text-xs text-ink-500">
              Withdrawal is effective from the date requested. It does not affect the lawfulness of
              processing that already happened.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleWithdraw} disabled={busy}>
              {busy ? 'Withdrawing…' : 'Confirm withdrawal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
