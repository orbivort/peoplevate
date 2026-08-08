import { motion } from 'framer-motion';
import { KeyRound, Lock, RefreshCw, ShieldCheck, Unlock } from 'lucide-react';
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
import { useAuth } from '@/contexts/auth-context';
import { rotateKey, useKeyVersions } from '@/data/data-layer';
import { cn, formatDate } from '@/lib/utils';

const purposeLabels: Record<string, string> = {
  DATA_ENCRYPTION: 'Field & file encryption',
  TOKEN_SIGNING: 'JWT / token signing',
};

const purposeDescriptions: Record<string, string> = {
  DATA_ENCRYPTION:
    'Used to encrypt PII and salary fields at rest, and to encrypt uploaded files at rest.',
  TOKEN_SIGNING:
    'Used to sign JWTs issued to authenticated sessions. Rotation issues a fresh signing key.',
};

export function KeyManagementPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageConsentAndKeys');
  const { data: versions, mode, reload: reloadVersions } = useKeyVersions();

  const [rotatePurpose, setRotatePurpose] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeData = versions.find((v) => v.purpose === 'DATA_ENCRYPTION' && v.status === 'ACTIVE');
  const activeToken = versions.find((v) => v.purpose === 'TOKEN_SIGNING' && v.status === 'ACTIVE');

  async function handleRotate() {
    if (!rotatePurpose) return;
    setBusy(true);
    try {
      await rotateKey(rotatePurpose);
      setFeedback('Key version rotated. Existing data will be re-encrypted by the scheduled job.');
      reloadVersions();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Rotation failed.');
    } finally {
      setRotatePurpose(null);
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Encryption keys"
        description="Manage the versions of keys used to encrypt data at rest and sign tokens."
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

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent-100 p-2 text-accent-700">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  {purposeLabels.DATA_ENCRYPTION}
                </div>
                <div className="text-xs text-ink-500">{purposeDescriptions.DATA_ENCRYPTION}</div>
              </div>
            </div>
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRotatePurpose('DATA_ENCRYPTION')}
              >
                <RefreshCw className="text-accent-600" />
                Rotate
              </Button>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-xs text-ink-600">
              <KeyRound className="h-4 w-4 text-ink-400" />
              {activeData ? `Active: ${activeData.keyId}` : 'No active version'}
            </div>
            <Badge variant={activeData?.status === 'ACTIVE' ? 'success' : 'warning'}>
              {activeData?.status ?? 'MISSING'}
            </Badge>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
                <Unlock className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  {purposeLabels.TOKEN_SIGNING}
                </div>
                <div className="text-xs text-ink-500">{purposeDescriptions.TOKEN_SIGNING}</div>
              </div>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setRotatePurpose('TOKEN_SIGNING')}>
                <RefreshCw className="text-accent-600" />
                Rotate
              </Button>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-xs text-ink-600">
              <KeyRound className="h-4 w-4 text-ink-400" />
              {activeToken ? `Active: ${activeToken.keyId}` : 'No active version'}
            </div>
            <Badge variant={activeToken?.status === 'ACTIVE' ? 'success' : 'warning'}>
              {activeToken?.status ?? 'MISSING'}
            </Badge>
          </div>
        </Card>
      </div>

      <Card>
        {versions.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No key versions"
            description="Key versions are bootstrapped at installation and appear here."
          />
        ) : (
          <div>
            <div className="border-b border-ink-200 px-4 py-2 text-xs font-medium tracking-wide text-ink-500">
              All key versions
            </div>
            <div className="divide-y divide-ink-200">
              {versions.map((v, i) => (
                <motion.div
                  key={v.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-ink-50/60"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded bg-ink-100 p-1.5 text-ink-500">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-mono text-sm font-medium text-ink-900">{v.keyId}</div>
                      <div className="text-xs text-ink-500">
                        {purposeLabels[v.purpose] ?? v.purpose} · {v.algorithm}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-ink-500">
                        {v.activatedAt
                          ? `Active since ${formatDate(v.activatedAt)}`
                          : 'Not yet active'}
                      </div>
                      {v.retiredAt && (
                        <div className="text-xs text-ink-400">
                          Retired {formatDate(v.retiredAt)}
                        </div>
                      )}
                    </div>
                    <Badge
                      className={cn(
                        'font-mono text-[10px]',
                        v.status === 'ACTIVE'
                          ? 'border-transparent bg-green-100 text-green-700'
                          : 'border-transparent bg-ink-100 text-ink-600',
                      )}
                    >
                      {v.status}
                    </Badge>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
        <p>
          Key rotation never blocks reads: new records use the new key version while existing
          ciphertext is re-encrypted in the background. For field-level data, the rotating keys
          script (<code className="rounded bg-ink-100 px-1 py-0.5 font-mono">pnpm key:rotate</code>)
          must be run by an operator to update the environment secret.
        </p>
      </div>

      <Dialog open={!!rotatePurpose} onOpenChange={(open) => !open && setRotatePurpose(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Rotate the {rotatePurpose ? purposeLabels[rotatePurpose] : ''} key. A new version is
              created and activated; the previous version is retired.
            </p>
            {rotatePurpose === 'DATA_ENCRYPTION' && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  After rotation, an operator must run{' '}
                  <code className="font-mono">pnpm key:rotate</code> to update the environment
                  secret, then <code className="font-mono">pnpm key:reencrypt</code> to re-encrypt
                  existing data with the new key.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotatePurpose(null)}>
              Cancel
            </Button>
            <Button onClick={handleRotate} disabled={busy}>
              {busy ? 'Rotating…' : 'Rotate key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
