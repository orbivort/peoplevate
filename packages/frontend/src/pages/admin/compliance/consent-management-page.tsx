import { motion } from 'framer-motion';
import { Plus, RotateCcw, ShieldCheck } from 'lucide-react';
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
import { recordConsent, useConsentRecords, withdrawConsent } from '@/data/data-layer';
import { cn, formatDate } from '@/lib/utils';
import type { ConsentMechanism, ConsentRecord } from '@/types';

const mechanismLabels: Record<string, string> = {
  CHECKBOX: 'Checkbox',
  SIGNATURE: 'Signature',
  EXPLICIT: 'Explicit',
};

const mechanismDescriptions: Record<string, string> = {
  CHECKBOX: 'Unticked checkbox on a consent form',
  SIGNATURE: 'Signed consent form (physical or e-signature)',
  EXPLICIT: 'Express, unambiguous consent for special-category data',
};

const purposeOptions: {
  value: string;
  label: string;
  description: string;
  specialCategory: boolean;
}[] = [
  {
    value: 'employee-data-processing',
    label: 'Employee data processing',
    description: 'Standard HR administration of employment data.',
    specialCategory: false,
  },
  {
    value: 'payroll',
    label: 'Payroll administration',
    description: 'Salary, tax and bank details for payroll.',
    specialCategory: false,
  },
  {
    value: 'candidate-recruitment',
    label: 'Candidate recruitment',
    description: 'Resume and application data for recruitment.',
    specialCategory: false,
  },
  {
    value: 'performance-management',
    label: 'Performance management',
    description: 'Performance reviews and appraisals.',
    specialCategory: false,
  },
  {
    value: 'medical-records',
    label: 'Medical / health records',
    description: 'Sick leave, medical certificates and health data.',
    specialCategory: true,
  },
  {
    value: 'national-id',
    label: 'National ID / biometrics',
    description: 'National identification number and similar identifiers.',
    specialCategory: true,
  },
];

const purposeLabels: Record<string, string> = {
  'employee-data-processing': 'Employee data processing',
  'candidate-recruitment': 'Candidate recruitment',
  'performance-management': 'Performance management',
  payroll: 'Payroll administration',
  'medical-records': 'Medical / health records',
  'national-id': 'National ID / biometrics',
};

export function ConsentManagementPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageConsentAndKeys');
  const { data: consents, mode, reload: reloadConsents } = useConsentRecords();

  const [search, setSearch] = useState('');
  const [withdrawTarget, setWithdrawTarget] = useState<ConsentRecord | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Record-consent dialog
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordEmail, setRecordEmail] = useState('');
  const [recordPurpose, setRecordPurpose] = useState('employee-data-processing');
  const [recordConsentText, setRecordConsentText] = useState('');
  const [recordNoticeVersion, setRecordNoticeVersion] = useState('v1');
  const [recordMechanism, setRecordMechanism] = useState<ConsentMechanism>('CHECKBOX');

  const selectedPurpose = purposeOptions.find((p) => p.value === recordPurpose);
  const isSpecialCategory = selectedPurpose?.specialCategory ?? false;
  const effectiveMechanism: ConsentMechanism = isSpecialCategory ? 'EXPLICIT' : recordMechanism;

  // Skip linked withdrawal records (withdrawsConsentId set) — they are duplicates
  // of the original record, which already carries the WITHDRAWN status.
  const filtered = consents.filter((c) => {
    if (c.withdrawsConsentId) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.dataSubjectEmail.toLowerCase().includes(q) ||
      (c.processingPurpose ?? '').toLowerCase().includes(q)
    );
  });

  async function handleWithdraw() {
    if (!withdrawTarget) return;
    setBusy(true);
    try {
      await withdrawConsent(withdrawTarget.id, withdrawReason || undefined);
      setFeedback('Consent withdrawn. A withdrawal record has been logged.');
      reloadConsents();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to withdraw consent.');
    } finally {
      setWithdrawTarget(null);
      setWithdrawReason('');
      setBusy(false);
    }
  }

  async function handleRecordConsent() {
    if (!recordEmail.trim() || !recordConsentText.trim()) {
      setFeedback('Data subject email and consent text are required.');
      return;
    }
    setBusy(true);
    try {
      await recordConsent({
        dataSubjectEmail: recordEmail.trim(),
        processingPurpose: recordPurpose,
        consentText: recordConsentText.trim(),
        noticeVersion: recordNoticeVersion.trim() || 'v1',
        mechanism: effectiveMechanism,
      });
      setFeedback('Consent recorded with full evidence.');
      reloadConsents();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to record consent.');
    } finally {
      setRecordOpen(false);
      setRecordEmail('');
      setRecordConsentText('');
      setRecordPurpose('employee-data-processing');
      setRecordNoticeVersion('v1');
      setRecordMechanism('CHECKBOX');
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Consent management"
        description="Evidence of consent given or withdrawn for each processing purpose."
        actions={
          canManage ? (
            <Button onClick={() => setRecordOpen(true)}>
              <Plus className="h-4 w-4" />
              Record consent
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by email or purpose…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="ml-auto text-sm text-ink-500">{filtered.length} records</div>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No consent records"
            description="Consent records created during onboarding and recruitment will appear here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data subject</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="w-[120px]">Mechanism</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[120px]">Recorded</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((consent, i) => (
                <motion.tr
                  key={consent.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                  className="group border-b border-ink-200 transition-colors hover:bg-ink-50/60"
                >
                  <TableCell>
                    <div className="text-sm font-medium text-ink-900">
                      {consent.dataSubjectEmail}
                    </div>
                    <div className="text-[10px] text-ink-400">v{consent.noticeVersion}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-ink-700">
                      {purposeLabels[consent.processingPurpose] ?? consent.processingPurpose}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {mechanismLabels[consent.mechanism] ?? consent.mechanism}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        'text-[10px]',
                        consent.status === 'GIVEN'
                          ? 'border-transparent bg-green-100 text-green-700'
                          : 'border-transparent bg-red-100 text-red-700',
                      )}
                    >
                      {consent.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-ink-500">{formatDate(consent.recordedAt)}</span>
                  </TableCell>
                  <TableCell>
                    {canManage && consent.status === 'GIVEN' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWithdrawTarget(consent)}
                      >
                        <RotateCcw className="text-amber-600" />
                        Withdraw
                      </Button>
                    )}
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
          Consent evidence records store the exact notice text the data subject agreed to, the
          mechanism used (checkbox, signature), the notice version, and a truncated IP address.
          Withdrawals never delete the original record — they create a linked withdrawal entry for a
          complete audit trail.
        </p>
      </div>

      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record consent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Capture consent with full evidence. This covers consent given on paper or in person,
              for standard purposes and for special-category (sensitive) data requiring explicit
              consent under GDPR Art. 9.
            </p>

            <div className="space-y-1.5">
              <Label>Data subject email</Label>
              <Input
                value={recordEmail}
                onChange={(e) => setRecordEmail(e.target.value)}
                placeholder="e.g. jane@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Processing purpose</Label>
              <Select value={recordPurpose} onValueChange={setRecordPurpose}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {purposeOptions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="inline-flex items-center gap-2">
                        {p.label}
                        {p.specialCategory && (
                          <Badge className="border-transparent bg-violet-100 text-violet-700">
                            Special category
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPurpose && (
                <p className="text-xs text-ink-500">{selectedPurpose.description}</p>
              )}
            </div>

            {isSpecialCategory && (
              <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  This purpose processes special-category (sensitive) data. Explicit consent is
                  required under GDPR Art. 9 — the mechanism is locked to <strong>Explicit</strong>.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Consent text</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
                value={recordConsentText}
                onChange={(e) => setRecordConsentText(e.target.value)}
                placeholder="Exact wording the data subject agreed to, e.g. “I consent to processing of my national ID for identity verification purposes.”"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Notice version</Label>
                <Input
                  value={recordNoticeVersion}
                  onChange={(e) => setRecordNoticeVersion(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Mechanism</Label>
                <Select
                  value={effectiveMechanism}
                  onValueChange={(v) => setRecordMechanism(v as ConsentMechanism)}
                  disabled={isSpecialCategory}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECKBOX">Checkbox</SelectItem>
                    <SelectItem value="SIGNATURE">Signature</SelectItem>
                    <SelectItem value="EXPLICIT">Explicit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-ink-500">
              Mechanism: {mechanismDescriptions[effectiveMechanism]}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRecordConsent} disabled={busy}>
              {busy ? 'Recording…' : 'Record consent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!withdrawTarget} onOpenChange={(open) => !open && setWithdrawTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw consent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Withdraw consent for <strong>{withdrawTarget?.dataSubjectEmail}</strong> regarding{' '}
              <strong>
                {purposeLabels[withdrawTarget?.processingPurpose ?? ''] ??
                  withdrawTarget?.processingPurpose}
              </strong>
              .
            </p>
            <div className="space-y-1.5">
              <Label>Lawful basis override (optional)</Label>
              <Select value={withdrawReason} onValueChange={setWithdrawReason}>
                <SelectTrigger>
                  <SelectValue placeholder="e.g. retain under legal obligation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Retained under legal obligation">
                    Retained under legal obligation
                  </SelectItem>
                  <SelectItem value="Retained under contract necessity">
                    Retained under contract necessity
                  </SelectItem>
                  <SelectItem value="Retained under legitimate interest">
                    Retained under legitimate interest
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-ink-500">
              The original consent record is preserved; a linked withdrawal record is created.
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
