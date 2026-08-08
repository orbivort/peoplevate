import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Download,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Shield,
  Upload,
  User,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useDocuments, useEmployees } from '@/data/data-layer';
import { employeeRepo } from '@/lib/api/repositories';
import { cn, daysUntil, formatDate, formatRelative, initials, mask } from '@/lib/utils';
import type { ChangeType, DocumentType } from '@/types';

const changeTypeColors: Record<ChangeType, string> = {
  Promotion: 'bg-accent-100 text-accent-800',
  Transfer: 'bg-blue-100 text-blue-700',
  'Manager Change': 'bg-ink-100 text-ink-700',
  'Salary Adjustment': 'bg-amber-100 text-amber-800',
  'Status Change': 'bg-purple-100 text-purple-700',
};

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission, canViewEmployee, user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const { data: employees } = useEmployees();
  const employee = useMemo(() => employees.find((e) => e.id === id) ?? null, [employees, id]);
  const { data: allDocuments } = useDocuments(employee?.id ?? '');

  // Local mutable copies so newly-added records show immediately (prototype)
  const [localDocuments, setLocalDocuments] = useState(allDocuments);
  const [localChanges, setLocalChanges] = useState<import('@/types').EmploymentChange[]>([]);

  useEffect(() => {
    queueMicrotask(() => setLocalDocuments(allDocuments));
  }, [allDocuments]);

  // Load employment change history from the backend.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!employee?.id) return;
      try {
        const changes = await employeeRepo.listChanges(employee.id);
        if (cancelled) return;
        setLocalChanges(
          changes.map((c) => ({
            id: String(c.id ?? ''),
            employeeId: employee.id,
            changeType: String(
              c.changeType ?? c.change_type ?? 'Status Change',
            ) as import('@/types').ChangeType,
            oldValue: c.oldValue != null ? String(c.oldValue) : '',
            newValue: c.newValue != null ? String(c.newValue) : '',
            reason: c.reason != null ? String(c.reason) : '',
            effectiveDate: String(c.effectiveDate ?? c.effective_date ?? ''),
            recordedBy: String(c.recordedBy ?? c.recorded_by ?? ''),
            recordedAt: String(c.createdAt ?? c.created_at ?? ''),
            status: String(c.status ?? 'PENDING') as 'Applied' | 'Pending',
          })),
        );
      } catch {
        // Leave the list empty if the backend is unavailable.
      }
    };
    queueMicrotask(() => load());
    return () => {
      cancelled = true;
    };
  }, [employee?.id]);

  // Dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  if (!employee) {
    return (
      <Card>
        <EmptyState
          icon={User}
          title="Employee not found"
          description="The employee record you are looking for does not exist or has been removed."
          action={
            <Button asChild variant="outline">
              <Link to="/app/employees">Back to employees</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  if (!canViewEmployee(employee)) {
    return (
      <Card>
        <EmptyState
          icon={Shield}
          title="Access restricted"
          description="You do not have permission to view this employee's profile."
          action={
            <Button asChild variant="outline">
              <Link to="/app/employees">Back to employees</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const canAccessSensitive = hasPermission('accessSalary');
  const isHrOrAdmin = hasPermission('viewAllEmployees');
  const isManagerOfEmployee = user?.role === 'Manager' && employee.managerId === user.employeeId;
  // Only HR/Admin can upload documents (compliance-related)
  const canUpload = isHrOrAdmin;
  // HR/Admin can record all changes; Manager can record certain changes for direct reports
  const canRecordChange = isHrOrAdmin || isManagerOfEmployee;
  const empDocuments = localDocuments.filter((d) => d.employeeId === employee.id);
  const empChanges = localChanges
    .filter((c) => c.employeeId === employee.id)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  return (
    <div>
      <Link
        to="/app/employees"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to employees
      </Link>

      {/* Header card */}
      <Card className="mb-6 overflow-hidden">
        <div className="relative h-24 bg-gradient-to-r from-ink-900 to-ink-700">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute -top-8 right-12 h-32 w-32 rounded-full bg-accent-500/40 blur-3xl" />
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <Avatar className="-mt-10 h-20 w-20 border-4 border-white shadow-md">
                <AvatarFallback className="bg-ink-900 text-xl text-ink-50">
                  {initials(`${employee.firstName} ${employee.lastName}`)}
                </AvatarFallback>
              </Avatar>
              <div className="pb-1">
                <div className="flex items-center gap-3">
                  <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                    {employee.firstName} {employee.lastName}
                  </h1>
                  <StatusBadge status={employee.status} />
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  {employee.positionName} · {employee.departmentName}
                </p>
              </div>
            </div>
            {isHrOrAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link to={`/app/employees/${employee.id}/edit`}>
                    <Pencil className="h-4 w-4" />
                    Edit profile
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">
            Documents
            <span className="ml-1.5 rounded-full bg-ink-200 px-1.5 py-0.5 text-[10px] text-ink-600">
              {empDocuments.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="changes">
            Change history
            <span className="ml-1.5 rounded-full bg-ink-200 px-1.5 py-0.5 text-[10px] text-ink-600">
              {empChanges.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Personal info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-4 w-4 text-ink-400" />
                    Personal information
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <InfoRow label="Employee ID" value={employee.employeeNo} mono />
                  <InfoRow label="Date of birth" value={formatDate(employee.dateOfBirth)} />
                  <InfoRow label="Gender" value={employee.gender} />
                  <InfoRow
                    label="National ID"
                    value={canAccessSensitive ? employee.nationalId : mask(employee.nationalId)}
                    sensitive={!canAccessSensitive}
                  />
                </CardContent>
              </Card>

              {/* Contact */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-ink-400" />
                    Contact details
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <InfoRow label="Email" value={employee.email} icon={Mail} />
                  <InfoRow label="Phone" value={employee.phone} icon={Phone} />
                  <InfoRow label="Address" value={employee.address} icon={MapPin} />
                </CardContent>
              </Card>

              {/* Emergency contact */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-ink-400" />
                    Emergency contact
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <InfoRow label="Name" value={employee.emergencyContactName} />
                  <InfoRow label="Relationship" value={employee.emergencyContactRelationship} />
                  <InfoRow label="Phone" value={employee.emergencyContactPhone} />
                </CardContent>
              </Card>
            </div>

            {/* Employment sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-ink-400" />
                    Employment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <InfoRow label="Department" value={employee.departmentName} />
                  <InfoRow label="Position" value={employee.positionName} />
                  <InfoRow label="Manager" value={employee.managerName ?? '—'} />
                  <Separator />
                  <InfoRow
                    label="Hire date"
                    value={formatDate(employee.hireDate)}
                    icon={Calendar}
                  />
                  <InfoRow label="Employment type" value={employee.employmentType} />
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-500">Salary</span>
                    {canAccessSensitive ? (
                      <span className="font-mono text-sm font-semibold text-ink-900">
                        ${employee.salary.toLocaleString()}
                      </span>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[10px] text-ink-500">
                        <Shield className="h-3 w-3" />
                        Restricted
                      </Badge>
                    )}
                  </div>
                  {employee.deactivationDate && (
                    <InfoRow
                      label="Deactivation date"
                      value={formatDate(employee.deactivationDate)}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Record metadata</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-ink-500">
                  <div className="flex justify-between">
                    <span>Created</span>
                    <span className="text-ink-700">{formatRelative(employee.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last updated</span>
                    <span className="text-ink-700">{formatRelative(employee.updatedAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Documents tab */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Documents</CardTitle>
              {canUpload && (
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Upload
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {empDocuments.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No documents"
                  description="No documents have been uploaded for this employee yet."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Filename</TableHead>
                      <TableHead>Uploaded by</TableHead>
                      <TableHead>Upload date</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {empDocuments.map((doc) => {
                      const expiryDays = doc.expiryDate ? daysUntil(doc.expiryDate) : null;
                      const expired = expiryDays !== null && expiryDays < 0;
                      const soon = expiryDays !== null && expiryDays >= 0 && expiryDays <= 30;
                      return (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <Badge variant="secondary">{doc.type}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-ink-400" />
                              <span className="font-mono text-xs text-ink-700">
                                {doc.originalFilename}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-ink-600">{doc.uploadedBy}</TableCell>
                          <TableCell className="text-sm text-ink-600">
                            {formatDate(doc.uploadedAt)}
                          </TableCell>
                          <TableCell>
                            {doc.expiryDate ? (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1.5 text-xs font-medium',
                                  expired && 'text-red-600',
                                  soon && !expired && 'text-amber-600',
                                  !expired && !soon && 'text-ink-600',
                                )}
                              >
                                {expired && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                )}
                                {soon && !expired && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                )}
                                {formatDate(doc.expiryDate)}
                                {expired && ' · Expired'}
                                {soon && !expired && ` · ${expiryDays}d`}
                              </span>
                            ) : (
                              <span className="text-ink-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon-sm" title="Download">
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Change history tab */}
        <TabsContent value="changes" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Employment change history</CardTitle>
              {canRecordChange && (
                <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Record change
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {empChanges.length === 0 ? (
                <EmptyState
                  icon={Briefcase}
                  title="No changes recorded"
                  description="Employment changes (promotions, transfers, salary adjustments) will appear here."
                />
              ) : (
                <div className="space-y-4">
                  {empChanges.map((change, i) => (
                    <motion.div
                      key={change.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.3 }}
                      className="relative flex gap-4 pb-4 last:pb-0"
                    >
                      {/* Timeline line */}
                      {i < empChanges.length - 1 && (
                        <div className="absolute top-8 left-[15px] h-full w-px bg-ink-200" />
                      )}
                      <div
                        className={cn(
                          'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                          changeTypeColors[change.changeType],
                        )}
                      >
                        <Briefcase className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={cn(
                              'border-transparent',
                              changeTypeColors[change.changeType],
                            )}
                          >
                            {change.changeType}
                          </Badge>
                          <span className="text-xs text-ink-400">
                            {formatDate(change.effectiveDate)}
                          </span>
                          {change.status === 'Pending' && (
                            <Badge variant="outline" className="text-[10px]">
                              Pending
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <span className="rounded bg-ink-100 px-2 py-0.5 text-ink-600 line-through">
                            {change.oldValue}
                          </span>
                          <span className="text-ink-400">→</span>
                          <span className="rounded bg-accent-100 px-2 py-0.5 font-medium text-accent-800">
                            {change.newValue}
                          </span>
                        </div>
                        {change.reason && (
                          <p className="mt-1.5 text-xs text-ink-500">{change.reason}</p>
                        )}
                        <p className="mt-1.5 text-[11px] text-ink-400">
                          Recorded by {change.recordedBy} · {formatRelative(change.recordedAt)}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Document upload dialog */}
      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        employeeId={employee.id}
        uploadedBy={user?.email ?? 'system'}
        onUpload={(doc) => {
          setLocalDocuments((prev) => [...prev, doc]);
          setUploadOpen(false);
        }}
      />

      {/* Record employment change dialog */}
      <RecordChangeDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        employeeId={employee.id}
        recordedBy={user?.email ?? 'system'}
        isHrOrAdmin={isHrOrAdmin}
        onRecord={async (change) => {
          try {
            await employeeRepo.recordChange(employee.id, {
              changeType: change.changeType,
              oldValue: change.oldValue,
              newValue: change.newValue,
              effectiveDate: change.effectiveDate,
              reason: change.reason,
            });
            setLocalChanges((prev) => [...prev, change]);
            setChangeOpen(false);
          } catch {
            // Keep the dialog open and surface nothing extra; the prototype shows the local entry.
          }
        }}
      />
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon: Icon,
  mono,
  sensitive,
}: {
  label: string;
  value: string;
  icon?: typeof Mail;
  mono?: boolean;
  sensitive?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-ink-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
        {sensitive && <Shield className="h-3 w-3 text-amber-500" />}
      </div>
      <div className={cn('mt-1 text-sm text-ink-900', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload Document Dialog (FR-016)
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES: DocumentType[] = [
  'Contract',
  'National ID',
  'Passport',
  'Work Permit',
  'Certification',
  'Medical Certificate',
  'Other',
];

function UploadDocumentDialog({
  open,
  onOpenChange,
  employeeId,
  uploadedBy,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  uploadedBy: string;
  onUpload: (doc: import('@/types').EmployeeDocument) => void;
}) {
  const [type, setType] = useState<DocumentType>('Contract');
  const [filename, setFilename] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [fileSelected, setFileSelected] = useState(false);

  const reset = () => {
    setType('Contract');
    setFilename('');
    setExpiryDate('');
    setFileSelected(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpload({
      id: `doc-${Date.now()}`,
      employeeId,
      type,
      originalFilename: filename || 'untitled.pdf',
      fileSize: 102400,
      mimeType: 'application/pdf',
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      expiryDate: expiryDate || null,
    });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Upload a document for this employee. Files are stored securely and linked to the
            employee record.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Document type */}
          <div className="space-y-1.5">
            <Label>Document type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DocumentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* File picker (simulated) */}
          <div className="space-y-1.5">
            <Label>File</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-300 bg-ink-50 px-4 py-6 text-center transition-colors hover:border-accent-400 hover:bg-accent-50">
              <Upload className="h-6 w-6 text-ink-400" />
              <span className="text-sm text-ink-600">
                {fileSelected && filename ? (
                  <span className="font-mono text-xs text-ink-800">{filename}</span>
                ) : (
                  'Click to choose a file'
                )}
              </span>
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFilename(f.name);
                    setFileSelected(true);
                  }
                }}
              />
            </label>
          </div>

          {/* Expiry date (optional) */}
          <div className="space-y-1.5">
            <Label>Expiry date (optional)</Label>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!fileSelected}>
              Upload document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Record Employment Change Dialog (FR-018)
// ---------------------------------------------------------------------------

const CHANGE_TYPES: ChangeType[] = [
  'Promotion',
  'Transfer',
  'Manager Change',
  'Salary Adjustment',
  'Status Change',
];

function RecordChangeDialog({
  open,
  onOpenChange,
  employeeId,
  recordedBy,
  isHrOrAdmin = true,
  onRecord,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  recordedBy: string;
  isHrOrAdmin?: boolean;
  onRecord: (change: import('@/types').EmploymentChange) => void;
}) {
  // Managers can only record Manager Change and Status Change; HR/Admin can record all types
  const managerChangeTypes: ChangeType[] = ['Manager Change', 'Status Change'];
  const allowedTypes: ChangeType[] = isHrOrAdmin ? CHANGE_TYPES : managerChangeTypes;

  const [changeType, setChangeType] = useState<ChangeType>(allowedTypes[0]!);
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');

  const reset = () => {
    setChangeType(allowedTypes[0]!);
    setOldValue('');
    setNewValue('');
    setEffectiveDate('');
    setReason('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRecord({
      id: `chg-${Date.now()}`,
      employeeId,
      changeType,
      oldValue: oldValue || '—',
      newValue: newValue || '—',
      effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
      status: isHrOrAdmin ? 'Applied' : 'Pending',
      reason,
      recordedBy,
      recordedAt: new Date().toISOString(),
    });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record employment change</DialogTitle>
          <DialogDescription>
            {isHrOrAdmin
              ? 'Record a promotion, transfer, manager change, salary adjustment, or status change for this employee.'
              : 'Record a manager change or status change for your direct report. Changes will be submitted as pending for HR review.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Change type</Label>
            <Select value={changeType} onValueChange={(v) => setChangeType(v as ChangeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Old value</Label>
              <Input
                value={oldValue}
                onChange={(e) => setOldValue(e.target.value)}
                placeholder="e.g. Junior Engineer"
              />
            </div>
            <div className="space-y-1.5">
              <Label>New value</Label>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. Senior Engineer"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Effective date</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Brief reason for this change…"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!newValue}>
              Record change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
