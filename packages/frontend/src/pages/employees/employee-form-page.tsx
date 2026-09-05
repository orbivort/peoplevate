import { motion } from 'framer-motion';
import { ArrowLeft, Briefcase, Save, Shield, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import {
  createEmployee,
  updateEmployee,
  useDepartments,
  useEmployees,
  usePositions,
} from '@/data/data-layer';
import { ApiError } from '@/lib/api-client';
import { validateDate, validateRequired } from '@/lib/validation';
import type { Employee, EmploymentType } from '@/types';

interface FormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: '' | 'Male' | 'Female' | 'Other';
  nationalId: string;
  email: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  departmentId: string;
  positionId: string;
  managerId: string;
  hireDate: string;
  employmentType: '' | EmploymentType;
  salary: string;
  status: '' | Employee['status'];
}

/**
 * Initial blank state for the "New employee" form. No demo values are seeded —
 * the user fills in every field they want to submit. `managerId` defaults to
 * 'none' so the "Reports to" selector reads "None" (no manager assigned).
 */
const emptyForm: FormValues = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  nationalId: '',
  email: '',
  phone: '',
  address: '',
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactPhone: '',
  departmentId: '',
  positionId: '',
  managerId: 'none',
  hireDate: '',
  employmentType: '',
  salary: '',
  status: '',
};

/** Convert an ISO datetime (e.g. "2020-01-01T00:00:00.000Z") to a local
 * "yyyy-MM-dd" string that `<input type="date">` accepts. Returns '' if invalid. */
function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Map frontend display labels to backend Prisma enum values. */
const genderToEnum: Record<'Male' | 'Female' | 'Other', string> = {
  Male: 'MALE',
  Female: 'FEMALE',
  Other: 'OTHER',
};

const employmentTypeToEnum: Record<EmploymentType, string> = {
  'Full-time': 'FULL_TIME',
  'Part-time': 'PART_TIME',
  Contract: 'CONTRACT',
};

const statusToEnum: Record<Employee['status'], string> = {
  'New Hire': 'NEW_HIRE',
  Probation: 'PROBATION',
  Active: 'ACTIVE',
  'On Leave': 'ON_LEAVE',
  Terminated: 'TERMINATED',
};

export function EmployeeFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canAccessSensitive = hasPermission('accessSalary');
  const { data: employees } = useEmployees();
  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();

  const existing = useMemo(() => (id ? employees.find((e) => e.id === id) : null), [employees, id]);

  const [form, setForm] = useState<FormValues>(() => {
    if (existing) {
      return {
        firstName: existing.firstName,
        lastName: existing.lastName,
        dateOfBirth: existing.dateOfBirth,
        gender: existing.gender,
        nationalId: existing.nationalId,
        email: existing.email,
        phone: existing.phone,
        address: existing.address,
        emergencyContactName: existing.emergencyContactName,
        emergencyContactRelationship: existing.emergencyContactRelationship,
        emergencyContactPhone: existing.emergencyContactPhone,
        departmentId: existing.departmentId,
        positionId: existing.positionId,
        managerId: existing.managerId ?? 'none',
        hireDate: existing.hireDate,
        employmentType: existing.employmentType,
        salary: String(existing.salary),
        status: existing.status,
      };
    }
    return { ...emptyForm };
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string | undefined>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Tracks whether the form has been hydrated from a real employee record so we
  // never overwrite user edits with a stale render (edit mode only).
  const hydrated = useRef(false);

  // Hydrate the form once the employee record and reference data are available.
  // The Radix Select controls can only render a selected value when the
  // matching option is already present, so hydrating too early (before the
  // department/position options exist) leaves them showing "Select ...".
  useEffect(() => {
    if (hydrated.current || !isEdit) return;
    if (!existing || !departments.length || !positions.length) return;
    const deptId = existing.departmentId;
    const posId = positions.some((p) => p.id === existing.positionId) ? existing.positionId : '';
    queueMicrotask(() =>
      setForm({
        firstName: existing.firstName,
        lastName: existing.lastName,
        dateOfBirth: toDateInputValue(existing.dateOfBirth),
        gender: existing.gender,
        nationalId: existing.nationalId,
        email: existing.email,
        phone: existing.phone,
        address: existing.address,
        emergencyContactName: existing.emergencyContactName,
        emergencyContactRelationship: existing.emergencyContactRelationship,
        emergencyContactPhone: existing.emergencyContactPhone,
        departmentId: deptId,
        positionId: posId,
        managerId: existing.managerId ?? 'none',
        hireDate: toDateInputValue(existing.hireDate),
        employmentType: existing.employmentType,
        salary: String(existing.salary ?? ''),
        status: existing.status,
      }),
    );
    hydrated.current = true;
  }, [isEdit, existing, departments, positions]);

  const availablePositions = useMemo(
    () => positions.filter((p) => p.departmentId === form.departmentId),
    [positions, form.departmentId],
  );

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormValues, string | undefined>> = {};
    // Truly required (non-nullable in the backend schema).
    e.firstName = validateRequired(form.firstName, 'First name') ?? undefined;
    e.lastName = validateRequired(form.lastName, 'Last name') ?? undefined;
    e.email = validateRequired(form.email, 'Email') ?? undefined;
    e.departmentId = validateRequired(form.departmentId, 'Department') ?? undefined;
    e.positionId = validateRequired(form.positionId, 'Position') ?? undefined;
    e.hireDate = validateDate(form.hireDate, 'Hire date') ?? undefined;
    // employmentType is required by the backend create schema (no DB default is
    // sent through the API). Gender and status are optional there.
    e.employmentType = validateRequired(form.employmentType, 'Employment type') ?? undefined;

    // Optional fields — validate format only when a value is present, so an
    // existing record with empty optional values can still be saved.
    if (form.dateOfBirth) {
      e.dateOfBirth = validateDate(form.dateOfBirth, 'Date of birth') ?? undefined;
    }
    if (form.nationalId) {
      e.nationalId = validateRequired(form.nationalId, 'National ID') ?? undefined;
    }
    if (form.phone) {
      e.phone = validateRequired(form.phone, 'Phone') ?? undefined;
    }
    if (form.address) {
      e.address = validateRequired(form.address, 'Address') ?? undefined;
    }
    if (form.emergencyContactName) {
      e.emergencyContactName =
        validateRequired(form.emergencyContactName, 'Emergency contact name') ?? undefined;
    }
    if (form.emergencyContactPhone) {
      e.emergencyContactPhone =
        validateRequired(form.emergencyContactPhone, 'Emergency contact phone') ?? undefined;
    }
    if (canAccessSensitive && form.salary) {
      e.salary = validateRequired(form.salary, 'Salary') ?? undefined;
    }
    setErrors(e);
    return !Object.values(e).some(Boolean);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    // employmentType is required by the backend create schema; validation above
    // guarantees it is non-empty, so narrow the type for the payload below.
    if (!form.employmentType) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender ? genderToEnum[form.gender] : undefined,
        nationalId: form.nationalId.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        emergencyContactName: form.emergencyContactName.trim() || undefined,
        emergencyContactRelationship: form.emergencyContactRelationship.trim() || undefined,
        emergencyContactPhone: form.emergencyContactPhone.trim() || undefined,
        departmentId: form.departmentId,
        positionId: form.positionId,
        managerId: form.managerId === 'none' ? undefined : form.managerId,
        hireDate: form.hireDate,
        employmentType: employmentTypeToEnum[form.employmentType],
        salary: form.salary ? Number(form.salary) : undefined,
        status: form.status ? statusToEnum[form.status] : undefined,
      };

      if (isEdit) {
        await updateEmployee(id!, payload);
        navigate(`/app/employees/${id}`, { replace: true });
      } else {
        const result = await createEmployee(payload);
        // Navigate to the newly created employee's profile.
        navigate(`/app/employees/${result.id}`, { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError(
          err instanceof Error
            ? err.message
            : `Failed to ${isEdit ? 'update' : 'create'} employee.`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Link
        to={isEdit ? `/app/employees/${id}` : '/app/employees'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {isEdit ? 'Back to profile' : 'Back to employees'}
      </Link>

      <PageHeader
        title={isEdit ? 'Edit employee' : 'New employee'}
        description={
          isEdit
            ? 'Update the employee record. All changes are audit-logged.'
            : 'Create a new employee master record with personal, contact, and employment details.'
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={isEdit ? `/app/employees/${id}` : '/app/employees'}>Cancel</Link>
            </Button>
            <Button type="submit" form="employee-form" disabled={submitting}>
              <Save className="h-4 w-4" />
              {submitting
                ? isEdit
                  ? 'Saving…'
                  : 'Creating…'
                : isEdit
                  ? 'Save changes'
                  : 'Create employee'}
            </Button>
          </div>
        }
      />

      <form id="employee-form" onSubmit={handleSubmit} className="space-y-6">
        {submitError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {submitError}
          </div>
        )}

        {/* Personal information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4 text-ink-400" />
              Personal information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="First name" required error={errors.firstName}>
              <Input
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                placeholder="Jane"
              />
            </Field>
            <Field label="Last name" required error={errors.lastName}>
              <Input
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                placeholder="Doe"
              />
            </Field>
            <Field label="Date of birth" error={errors.dateOfBirth}>
              <Input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set('dateOfBirth', e.target.value)}
              />
            </Field>
            <Field label="Gender">
              <Select
                value={form.gender}
                onValueChange={(v) => set('gender', v as FormValues['gender'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="National ID"
              error={errors.nationalId}
              hint={canAccessSensitive ? 'Encrypted at rest (AES-256)' : 'Restricted to HR/Admin'}
              sensitive
            >
              <Input
                value={form.nationalId}
                onChange={(e) => set('nationalId', e.target.value)}
                placeholder="ID-XXXX-XXXXX"
                disabled={!canAccessSensitive}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Contact details */}
        <Card>
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Email" required error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="jane.doe@example.com"
              />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <Input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+1 123 555 0000"
              />
            </Field>
            <Field label="Address" error={errors.address} className="sm:col-span-2">
              <Textarea
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Street address, city, state, zip"
                rows={2}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Emergency contact */}
        <Card>
          <CardHeader>
            <CardTitle>Emergency contact</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Name" error={errors.emergencyContactName}>
              <Input
                value={form.emergencyContactName}
                onChange={(e) => set('emergencyContactName', e.target.value)}
                placeholder="John Doe"
              />
            </Field>
            <Field label="Relationship">
              <Input
                value={form.emergencyContactRelationship}
                onChange={(e) => set('emergencyContactRelationship', e.target.value)}
                placeholder="Spouse"
              />
            </Field>
            <Field label="Phone" error={errors.emergencyContactPhone}>
              <Input
                value={form.emergencyContactPhone}
                onChange={(e) => set('emergencyContactPhone', e.target.value)}
                placeholder="+1 123 555 0000"
              />
            </Field>
          </CardContent>
        </Card>

        {/* Employment details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-ink-400" />
              Employment details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Department" required error={errors.departmentId}>
              <Select
                value={form.departmentId}
                onValueChange={(v) => {
                  set('departmentId', v);
                  set('positionId', '');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Position" required error={errors.positionId}>
              <Select
                key={availablePositions.map((p) => p.id).join(',') || 'none'}
                value={form.positionId}
                onValueChange={(v) => set('positionId', v)}
                disabled={!form.departmentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {availablePositions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reports to (manager)">
              <Select value={form.managerId} onValueChange={(v) => set('managerId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {employees
                    .filter((e) => e.id !== id)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Hire date" required error={errors.hireDate}>
              <Input
                type="date"
                value={form.hireDate}
                onChange={(e) => set('hireDate', e.target.value)}
              />
            </Field>
            <Field label="Employment type" required error={errors.employmentType}>
              <Select
                value={form.employmentType}
                onValueChange={(v) => set('employmentType', v as EmploymentType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employment type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Full-time">Full-time</SelectItem>
                  <SelectItem value="Part-time">Part-time</SelectItem>
                  <SelectItem value="Contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(v) => set('status', v as Employee['status'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New Hire">New Hire</SelectItem>
                  <SelectItem value="Probation">Probation</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="On Leave">On Leave</SelectItem>
                  <SelectItem value="Terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Separator className="sm:col-span-2 lg:col-span-3" />
            <Field
              label="Annual salary (USD)"
              error={errors.salary}
              hint={canAccessSensitive ? 'Encrypted at rest (AES-256)' : 'Restricted to HR/Admin'}
              sensitive
            >
              <Input
                type="number"
                value={form.salary}
                onChange={(e) => set('salary', e.target.value)}
                placeholder="120000"
                disabled={!canAccessSensitive}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Compliance note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-start gap-2.5 rounded-lg border border-ink-200 bg-white p-4 text-xs text-ink-500"
        >
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
          <p>
            All changes to this employee record are captured in the immutable audit log with actor,
            action, old/new values, and timestamp. Sensitive fields (national ID, salary) are
            encrypted at rest with AES-256 and access-restricted to Admin and HR Manager roles.
            Records are soft-deleted only — never physically removed — per the retention policy.
          </p>
        </motion.div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  sensitive,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  sensitive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="flex items-center gap-1.5">
        {label}
        {required && <span className="text-red-500">*</span>}
        {sensitive && <Shield className="h-3 w-3 text-amber-500" />}
      </Label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}
