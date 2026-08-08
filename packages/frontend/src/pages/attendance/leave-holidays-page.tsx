import { motion } from 'framer-motion';
import {
  Briefcase,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Landmark,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { attendanceRepo } from '@/lib/api/workflow-repositories';
import { cn, formatDate } from '@/lib/utils';
import type { Holiday, HolidayType, LeavePolicyGroup } from '@/types';

const EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Full-Time' },
  { value: 'PART_TIME', label: 'Part-Time' },
  { value: 'CONTRACT', label: 'Contract' },
] as const;

const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  STATUTORY: 'Statutory',
  COMPANY: 'Company',
  FLOATING: 'Floating',
};

const HOLIDAY_TYPE_BADGE: Record<
  HolidayType,
  { variant: 'accent' | 'info' | 'warning'; text: string }
> = {
  STATUTORY: { variant: 'accent', text: 'Statutory' },
  COMPANY: { variant: 'info', text: 'Company' },
  FLOATING: { variant: 'warning', text: 'Floating' },
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayYear(): number {
  return new Date().getFullYear();
}

export function LeaveHolidaysPage() {
  const [tab, setTab] = useState('policies');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manageOrg');

  return (
    <div>
      <PageHeader
        title="Leave & Holidays"
        description="Configure leave entitlement policies and the company holiday calendar."
        actions={
          !canManage ? (
            <Badge variant="secondary" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-accent-600" />
              View only
            </Badge>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="policies">
            <ShieldCheck className="h-3.5 w-3.5" />
            Leave Policies
          </TabsTrigger>
          <TabsTrigger value="holidays">
            <Landmark className="h-3.5 w-3.5" />
            Holiday Calendar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="policies" className="mt-4">
          <LeavePoliciesTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="holidays" className="mt-4">
          <HolidayCalendarTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab 1 — Leave Policies
// ─────────────────────────────────────────────────────────────

function LeavePoliciesTab({ canManage }: { canManage: boolean }) {
  const [year, setYear] = useState<number>(todayYear());
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = useState<LeavePolicyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<LeavePolicyGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<LeavePolicyGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [types, grps] = await Promise.all([
        attendanceRepo.listLeaveTypes(),
        attendanceRepo.listPolicyGroups(year),
      ]);
      setLeaveTypes(types);
      setGroups(grps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leave policies.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleDeleteGroup = (group: LeavePolicyGroup) => {
    setDeletingGroup(group);
  };

  const confirmDeleteGroup = async () => {
    if (!deletingGroup) return;
    setDeleting(true);
    setError(null);
    try {
      await attendanceRepo.deletePolicyGroup(deletingGroup.id);
      setToast(`Deleted ${deletingGroup.name}`);
      setDeletingGroup(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete policy group.');
    } finally {
      setDeleting(false);
    }
  };

  const yearNav = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setYear((y) => y - 1)}
        aria-label="Previous year"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[72px] text-center font-display text-lg font-semibold text-ink-900">
        {year}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setYear((y) => y + 1)}
        aria-label="Next year"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <CalendarRange className="h-4 w-4 text-ink-400" />
            Entitlement policies by employee segment. Matching employees are entitled automatically
            based on their employment attributes.
          </div>
          {yearNav}
        </div>
      </Card>

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-800"
        >
          <Check className="h-4 w-4" />
          {toast}
        </motion.div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Policy Groups Grid */}
      <Card>
        <CardHeader className="border-b border-ink-100 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Entitlement rules by policy group</CardTitle>
              <CardDescription>
                Days per leave type for {year}. Employees are matched automatically by employment
                attributes.
              </CardDescription>
            </div>
            {canManage && (
              <Button
                variant="default"
                onClick={() => {
                  setEditingGroup(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Create Policy Group
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading policies&hellip;
            </div>
          ) : leaveTypes.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No leave types configured"
              description="Create leave types first so you can set entitlements for them."
            />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No policy groups yet"
              description="Create a policy group to define leave entitlements based on employment type, grade"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">Policy Group</TableHead>
                    {leaveTypes.map((lt) => (
                      <TableHead key={lt.id} className="min-w-[110px] text-center">
                        {lt.name}
                      </TableHead>
                    ))}
                    {canManage && (
                      <TableHead className="min-w-[110px] text-center">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => {
                    const entitlementFor = (ltId: string) =>
                      group.entitlements.find((e) => e.leave_type_id === ltId);
                    return (
                      <motion.tr
                        key={group.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="group border-b border-ink-200 hover:bg-ink-50/60"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700">
                              <ShieldCheck className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-ink-900">{group.name}</div>
                              <div className="flex flex-wrap items-center gap-1 text-xs text-ink-400">
                                {group.employment_type && (
                                  <span className="rounded bg-ink-100 px-1.5 py-0.5">
                                    {EMPLOYMENT_TYPES.find((t) => t.value === group.employment_type)
                                      ?.label ?? group.employment_type}
                                  </span>
                                )}
                                {group.grades.length > 0 && (
                                  <span className="rounded bg-ink-100 px-1.5 py-0.5">
                                    Grades: {group.grades.join(', ')}
                                  </span>
                                )}
                                {!group.employment_type &&
                                  group.grades.length === 0 &&
                                  !group.department_id && (
                                    <span className="rounded bg-ink-100 px-1.5 py-0.5">
                                      All employees
                                    </span>
                                  )}
                                {group.proration_enabled && (
                                  <span className="rounded bg-accent-50 px-1.5 py-0.5 text-accent-600">
                                    Prorated
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        {leaveTypes.map((lt) => {
                          const ent = entitlementFor(lt.id);
                          return (
                            <TableCell key={lt.id} className="text-center">
                              {ent ? (
                                <span className="inline-flex h-7 min-w-[40px] items-center justify-center rounded-md bg-ink-50 px-2 text-sm font-medium text-ink-900">
                                  {ent.annual_days}
                                </span>
                              ) : (
                                <span className="text-ink-300">&mdash;</span>
                              )}
                            </TableCell>
                          );
                        })}
                        {canManage && (
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="sm"
                                variant="subtle"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setEditingGroup(group);
                                  setDialogOpen(true);
                                }}
                              >
                                <Edit3 className="h-3 w-3" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-ink-400 hover:text-red-600"
                                onClick={() => handleDeleteGroup(group)}
                                aria-label={`Delete ${group.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </motion.tr>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-4">
        <div className="flex items-start gap-2 text-xs text-ink-500">
          <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <p>
            <span className="font-medium text-ink-700">Policy groups</span> define entitlement by
            employment attributes (type, grade) and leave type. This ensures all employees receive
            leave entitlements based on their employment attributes.
          </p>
        </div>
      </Card>

      {/* Create/Edit Policy Group Dialog */}
      {canManage && (
        <PolicyGroupDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingGroup={editingGroup}
          leaveTypes={leaveTypes}
          year={year}
          onSaved={() => {
            setDialogOpen(false);
            void load();
          }}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deletingGroup !== null} onOpenChange={(o) => !o && setDeletingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete policy group</DialogTitle>
            <DialogDescription>
              This will permanently remove &ldquo;{deletingGroup?.name}&rdquo; and its entitlements.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingGroup(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteGroup} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Policy Group Create/Edit Dialog
// ─────────────────────────────────────────────────────────────

function PolicyGroupDialog({
  open,
  onOpenChange,
  editingGroup,
  leaveTypes,
  year,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingGroup: LeavePolicyGroup | null;
  leaveTypes: { id: string; name: string }[];
  year: number;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [grades, setGrades] = useState<string[]>([]);
  const [gradeInput, setGradeInput] = useState('');
  const [proration, setProration] = useState(true);
  const [entitlements, setEntitlements] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        if (editingGroup) {
          setName(editingGroup.name);
          setDescription(editingGroup.description ?? '');
          setEmploymentType(editingGroup.employment_type ?? '');
          setGrades(editingGroup.grades ?? []);
          setGradeInput('');
          setProration(editingGroup.proration_enabled);
          const entMap: Record<string, string> = {};
          for (const e of editingGroup.entitlements) {
            entMap[e.leave_type_id] = String(e.annual_days);
          }
          setEntitlements(entMap);
        } else {
          setName('');
          setDescription('');
          setEmploymentType('');
          setGrades([]);
          setGradeInput('');
          setProration(true);
          setEntitlements({});
        }
        setError(null);
      });
    }
  }, [open, editingGroup]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entArray = leaveTypes
        .filter((lt) => entitlements[lt.id] !== undefined && entitlements[lt.id] !== '')
        .map((lt) => ({
          leave_type_id: lt.id,
          annual_days: Number(entitlements[lt.id]),
        }));

      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        year,
        employment_type: employmentType || undefined,
        grades: grades.map((g) => g.trim()).filter(Boolean),
        proration_enabled: proration,
        entitlements: entArray,
      };

      if (editingGroup) {
        await attendanceRepo.updatePolicyGroup(editingGroup.id, payload);
      } else {
        await attendanceRepo.createPolicyGroup(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save policy group.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingGroup ? 'Edit policy group' : 'Create policy group'}</DialogTitle>
          <DialogDescription>
            Define entitlement days per leave type and who qualifies based on employment attributes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pg-name">Name *</Label>
              <Input
                id="pg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Full-Time Standard"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-year">Year</Label>
              <Input id="pg-year" value={String(year)} disabled className="bg-ink-50" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pg-desc">Description</Label>
            <Input
              id="pg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div className="rounded-lg border border-ink-200 p-3">
            <div className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
              Eligibility Criteria
            </div>
            <div className="text-xs text-ink-400">Leave a field blank to match all values.</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pg-etype">Employment Type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger id="pg-etype">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Position Grades</Label>
                <div className="flex gap-2">
                  <Input
                    id="pg-grade"
                    value={gradeInput}
                    onChange={(e) => setGradeInput(e.target.value)}
                    placeholder="e.g., L4"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const v = gradeInput.trim();
                        if (v && !grades.includes(v)) setGrades((prev) => [...prev, v]);
                        setGradeInput('');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    className="h-9 shrink-0 px-2"
                    onClick={() => {
                      const v = gradeInput.trim();
                      if (v && !grades.includes(v)) setGrades((prev) => [...prev, v]);
                      setGradeInput('');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {grades.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {grades.map((g) => (
                      <span
                        key={g}
                        className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-800"
                      >
                        {g}
                        <button
                          type="button"
                          className="text-ink-400 transition-colors hover:text-red-600"
                          onClick={() => setGrades((prev) => prev.filter((x) => x !== g))}
                          aria-label={`Remove grade ${g}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={proration}
                    onChange={(e) => setProration(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-accent-600"
                  />
                  Prorate for mid-year joiners
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-3">
            <div className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">
              Entitlements (days per year)
            </div>
            <div className="grid grid-cols-2 gap-3">
              {leaveTypes.map((lt) => (
                <div key={lt.id} className="space-y-1.5">
                  <Label htmlFor={`pg-ent-${lt.id}`}>{lt.name}</Label>
                  <Input
                    id={`pg-ent-${lt.id}`}
                    type="number"
                    min={0}
                    value={entitlements[lt.id] ?? ''}
                    onChange={(e) =>
                      setEntitlements((prev) => ({ ...prev, [lt.id]: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {editingGroup ? 'Save changes' : 'Create & save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// Tab 2 — Holiday Calendar
// ─────────────────────────────────────────────────────────────

function HolidayCalendarTab({ canManage }: { canManage: boolean }) {
  const [year, setYear] = useState<number>(todayYear());
  const [month, setMonth] = useState<number>(new Date().getMonth());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    date: string;
    type: HolidayType;
    recurring: boolean;
  }>({ name: '', date: '', type: 'STATUTORY', recurring: false });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHolidays(await attendanceRepo.listHolidays(year));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load holidays.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const holidaysByDate = useMemo(() => {
    const map: Record<string, Holiday> = {};
    for (const h of holidays) {
      const key = h.date.slice(0, 10);
      map[key] = h;
    }
    return map;
  }, [holidays]);

  const firstDayOfMonth = useMemo(() => new Date(year, month, 1), [year, month]);
  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  const startOffset = useMemo(() => {
    const dow = firstDayOfMonth.getDay(); // 0 = Sunday
    return (dow + 6) % 7; // Monday = 0
  }, [firstDayOfMonth]);

  const cells: (number | null)[] = useMemo(() => {
    const arr: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [startOffset, daysInMonth]);

  const yearHolidays = useMemo(
    () => [...holidays].sort((a, b) => a.date.localeCompare(b.date)),
    [holidays],
  );

  const holidaysByMonth = useMemo(() => {
    const groups: Record<number, typeof yearHolidays> = {};
    for (const h of yearHolidays) {
      const m = new Date(h.date).getMonth();
      (groups[m] ??= []).push(h);
    }
    return groups;
  }, [yearHolidays]);

  const openAdd = (date?: string) => {
    const today = new Date();
    const defaultDate =
      date ??
      `${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setForm({ name: '', date: defaultDate, type: 'STATUTORY', recurring: false });
    setDialogOpen(true);
  };

  const openEdit = (h: Holiday) => {
    setForm({
      name: h.name,
      date: h.date.slice(0, 10),
      type: h.type,
      recurring: h.recurring,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Holiday name is required.');
      return;
    }
    if (!form.date) {
      setError('A date is required.');
      return;
    }
    setSaving(true);
    try {
      await attendanceRepo.upsertHoliday({
        name: form.name.trim(),
        date: form.date,
        year: new Date(form.date).getFullYear(),
        type: form.type,
        recurring: form.recurring,
      });
      const dt = new Date(form.date);
      setYear(dt.getFullYear());
      setMonth(dt.getMonth());
      await load();
      setDialogOpen(false);
      setToast(`Saved holiday “${form.name.trim()}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save holiday.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (h: Holiday) => {
    setDeletingId(h.id);
    setError(null);
    try {
      await attendanceRepo.deleteHoliday(h.id);
      setHolidays((prev) => prev.filter((x) => x.id !== h.id));
      setToast(`Removed “${h.name}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete holiday.');
    } finally {
      setDeletingId(null);
    }
  };

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = (day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Landmark className="h-4 w-4 text-ink-400" />
            Mark statutory &amp; company holidays — employees show “Holiday” instead of “Absent”.
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-ink-200 p-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={prevMonth}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[130px] text-center text-sm font-medium text-ink-800">
                {MONTHS[month]} {year}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={nextMonth} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {canManage && (
              <Button variant="default" onClick={() => openAdd()}>
                <Plus className="h-4 w-4" />
                Add holiday
              </Button>
            )}
          </div>
        </div>
      </Card>

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-800"
        >
          <Check className="h-4 w-4" />
          {toast}
        </motion.div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b border-ink-100 pb-3">
            <CardTitle className="text-base">Calendar</CardTitle>
            <CardDescription>
              {canManage
                ? 'Click a date to add a holiday.'
                : 'View the company holiday calendar for this year.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-ink-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading calendar…
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAYS.map((d) => (
                    <div
                      key={d}
                      className="py-1 text-[11px] font-medium tracking-wider text-ink-400 uppercase"
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {cells.map((day, i) => {
                    if (day === null) return <div key={`empty-${i}`} className="h-16 rounded-lg" />;
                    const key = dateKey(day);
                    const holiday = holidaysByDate[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => canManage && (holiday ? openEdit(holiday) : openAdd(key))}
                        className={cn(
                          'flex h-16 flex-col items-center justify-center gap-1 rounded-lg border text-sm transition-all',
                          'focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:outline-none',
                          holiday
                            ? 'border-accent-200 bg-accent-50 text-accent-900 shadow-sm hover:border-accent-300'
                            : 'border-ink-100 bg-white text-ink-700 hover:border-accent-300 hover:bg-ink-50',
                        )}
                      >
                        <span className={cn('font-medium', holiday && 'font-semibold')}>{day}</span>
                        {holiday && (
                          <span className="max-w-[80%] truncate text-[10px] leading-tight font-medium text-accent-700">
                            {holiday.name}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-ink-100 pb-3">
            <CardTitle className="text-base">{year} holidays</CardTitle>
            <CardDescription>
              {yearHolidays.length} day{yearHolidays.length === 1 ? '' : 's'} in {year}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {yearHolidays.length === 0 ? (
              <EmptyState
                icon={Landmark}
                title="No holidays this year"
                description="Add statutory or company holidays to keep attendance accurate."
              />
            ) : (
              <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
                {MONTHS.map((monthName, m) => {
                  const items = holidaysByMonth[m];
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={m}>
                      <div className="sticky top-0 mb-1.5 bg-white py-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                        {monthName}
                      </div>
                      <ul className="space-y-2">
                        {items.map((h) => {
                          const badge = HOLIDAY_TYPE_BADGE[h.type] ?? HOLIDAY_TYPE_BADGE.STATUTORY;
                          return (
                            <motion.li
                              key={h.id}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="group flex items-start gap-3 rounded-lg border border-ink-100 p-2.5 hover:border-ink-200"
                            >
                              <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-ink-900 text-ink-50">
                                <span className="text-sm leading-none font-bold">
                                  {new Date(h.date).getDate()}
                                </span>
                                <span className="text-[9px] leading-none text-ink-400 uppercase">
                                  {(MONTHS[new Date(h.date).getMonth()] ?? '').slice(0, 3)}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-sm font-medium text-ink-900">
                                    {h.name}
                                  </span>
                                  {h.recurring && (
                                    <Badge variant="outline" className="text-[10px]">
                                      annual
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <Badge variant={badge.variant} className="text-[10px]">
                                    {badge.text}
                                  </Badge>
                                  <span className="text-[11px] text-ink-400">
                                    {formatDate(h.date)}
                                  </span>
                                </div>
                              </div>
                              {canManage && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-red-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600"
                                  onClick={() => handleDelete(h)}
                                  disabled={deletingId === h.id}
                                  aria-label={`Delete ${h.name}`}
                                >
                                  {deletingId === h.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              )}
                            </motion.li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canManage && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Holiday</DialogTitle>
              <DialogDescription>
                Add or edit a statutory or company holiday for the calendar.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="hol-name">Name *</Label>
                <Input
                  id="hol-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. New Year's Day"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hol-date">Date *</Label>
                <Input
                  id="hol-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as HolidayType }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HOLIDAY_TYPE_LABELS) as HolidayType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {HOLIDAY_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={form.recurring}
                  onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.checked }))}
                  className="h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-500"
                />
                Recur every year (auto-applies to future years)
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="default" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {saving ? 'Saving…' : 'Save holiday'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
