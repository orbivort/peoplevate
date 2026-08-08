import { useCallback, useEffect, useState } from 'react';
import {
  Pencil,
  Save,
  X,
  Phone,
  MapPin,
  AlertCircle,
  User,
  Mail,
  Calendar,
  Briefcase,
  IdCard,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/auth-context';
import { employeeRepo } from '@/lib/api/repositories';
import { isRealBackend } from '@/data/data-layer';
import type { Employee } from '@/types';

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface FieldRowProps {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
}

function FieldRow({ label, value, icon }: FieldRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        {icon}
        {label}
      </div>
      <div className="text-right text-sm font-medium text-ink-900">{value || '—'}</div>
    </div>
  );
}

interface EditableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string;
  multiline?: boolean;
}

function EditableField({
  label,
  value,
  onChange,
  error,
  placeholder,
  multiline,
}: EditableFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-ink-500">{label}</Label>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={error ? 'border-red-500' : ''}
          rows={2}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={error ? 'border-red-500' : ''}
        />
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function ProfilePage() {
  const { user, employee, updateEmployee, hasPermission } = useAuth();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Editable fields state
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRelationship, setEmergencyRelationship] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Refresh employee data in background
  useEffect(() => {
    if (!isRealBackend() || !user?.employeeId) return;
    employeeRepo
      .get(user.employeeId)
      .then((emp) => {
        updateEmployee(emp);
      })
      .catch(() => {
        // Background refresh failure is silent — cached data is still shown
      });
  }, [user?.employeeId, updateEmployee]);

  // Sync editable fields when entering edit mode
  const enterEditMode = useCallback(() => {
    if (!employee) return;
    setPhone(employee.phone ?? '');
    setAddress(employee.address ?? '');
    setEmergencyName(employee.emergencyContactName ?? '');
    setEmergencyRelationship(employee.emergencyContactRelationship ?? '');
    setEmergencyPhone(employee.emergencyContactPhone ?? '');
    setErrors({});
    setEditMode(true);
  }, [employee]);

  const validatePhone = (value: string): string | null => {
    if (value.trim() && value.replace(/\D/g, '').length < 7) {
      return 'Phone number must contain at least 7 digits.';
    }
    return null;
  };

  const handleSave = useCallback(async () => {
    if (!employee || !user?.employeeId) return;

    const newErrors: Record<string, string> = {};

    // Validate phone if it was previously set or is now non-empty
    const phoneErr = validatePhone(phone);
    if (phoneErr) newErrors.phone = phoneErr;

    const emergencyPhoneErr = validatePhone(emergencyPhone);
    if (emergencyPhoneErr) newErrors.emergencyPhone = emergencyPhoneErr;

    // Check no previously-populated field is emptied
    if (employee.phone && !phone.trim()) newErrors.phone = 'Phone cannot be emptied.';
    if (employee.address && !address.trim()) newErrors.address = 'Address cannot be emptied.';
    if (employee.emergencyContactName && !emergencyName.trim()) {
      newErrors.emergencyName = 'Emergency contact name cannot be emptied.';
    }
    if (employee.emergencyContactPhone && !emergencyPhone.trim()) {
      newErrors.emergencyPhone = 'Emergency contact phone cannot be emptied.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const fields = {
        phone,
        address,
        emergencyContactName: emergencyName,
        emergencyContactRelationship: emergencyRelationship,
        emergencyContactPhone: emergencyPhone,
      };

      if (isRealBackend()) {
        await employeeRepo.selfUpdate(user.employeeId, fields);
      }

      // Update cached auth context
      updateEmployee({
        phone,
        address,
        emergencyContactName: emergencyName,
        emergencyContactRelationship: emergencyRelationship,
        emergencyContactPhone: emergencyPhone,
      } as Partial<Employee>);

      setToast({ type: 'success', message: 'Profile updated successfully.' });
      setEditMode(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save changes. Please try again.';
      setToast({ type: 'error', message });
    } finally {
      setSaving(false);
    }
  }, [
    employee,
    user?.employeeId,
    phone,
    address,
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
    updateEmployee,
  ]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-12 w-12 text-ink-300" />
        <h2 className="mt-4 text-lg font-semibold text-ink-900">No employee profile linked</h2>
        <p className="mt-1 text-sm text-ink-500">
          No employee profile is linked to your account. Please contact HR.
        </p>
      </div>
    );
  }

  const canAccessSalary = hasPermission('accessSalary');

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">My Profile</h1>
          <p className="mt-1 text-sm text-ink-500">View and manage your personal information</p>
        </div>
        {!editMode ? (
          <Button onClick={enterEditMode} variant="default">
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={() => setEditMode(false)} variant="outline" disabled={saving}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </div>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-ink-100">
          <FieldRow
            label="Employee No."
            value={employee.employeeNo}
            icon={<IdCard className="h-4 w-4" />}
          />
          <FieldRow
            label="First Name"
            value={employee.firstName}
            icon={<User className="h-4 w-4" />}
          />
          <FieldRow
            label="Last Name"
            value={employee.lastName}
            icon={<User className="h-4 w-4" />}
          />
          <FieldRow
            label="Date of Birth"
            value={formatDate(employee.dateOfBirth)}
            icon={<Calendar className="h-4 w-4" />}
          />
          <FieldRow label="Gender" value={employee.gender} icon={<User className="h-4 w-4" />} />
          <FieldRow
            label="National ID"
            value={canAccessSalary ? employee.nationalId : '••••••••'}
            icon={<IdCard className="h-4 w-4" />}
          />
        </CardContent>
      </Card>

      {/* Contact Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact Details</CardTitle>
        </CardHeader>
        <CardContent>
          {editMode ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-ink-500">Email (read-only)</Label>
                  <Input value={employee.email} disabled />
                  <p className="text-xs text-ink-400">Contact HR to change your email address.</p>
                </div>
                <EditableField
                  label="Phone"
                  value={phone}
                  onChange={setPhone}
                  error={errors.phone}
                  placeholder="+1 234 567 890"
                />
              </div>
              <EditableField
                label="Address"
                value={address}
                onChange={setAddress}
                error={errors.address}
                placeholder="123 Main St, City, Country"
                multiline
              />
            </div>
          ) : (
            <div className="divide-y divide-ink-100">
              <FieldRow label="Email" value={employee.email} icon={<Mail className="h-4 w-4" />} />
              <FieldRow label="Phone" value={employee.phone} icon={<Phone className="h-4 w-4" />} />
              <FieldRow
                label="Address"
                value={employee.address}
                icon={<MapPin className="h-4 w-4" />}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Emergency Contact */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Emergency Contact</CardTitle>
        </CardHeader>
        <CardContent>
          {editMode ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditableField
                label="Contact Name"
                value={emergencyName}
                onChange={setEmergencyName}
                error={errors.emergencyName}
                placeholder="Jane Doe"
              />
              <EditableField
                label="Relationship"
                value={emergencyRelationship}
                onChange={setEmergencyRelationship}
                placeholder="Spouse, Parent, Sibling, etc."
              />
              <EditableField
                label="Contact Phone"
                value={emergencyPhone}
                onChange={setEmergencyPhone}
                error={errors.emergencyPhone}
                placeholder="+1 234 567 890"
              />
            </div>
          ) : canAccessSalary ? (
            <div className="divide-y divide-ink-100">
              <FieldRow
                label="Contact Name"
                value={employee.emergencyContactName}
                icon={<User className="h-4 w-4" />}
              />
              <FieldRow label="Relationship" value={employee.emergencyContactRelationship} />
              <FieldRow
                label="Contact Phone"
                value={employee.emergencyContactPhone}
                icon={<Phone className="h-4 w-4" />}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center py-6">
              <p className="text-sm text-ink-400">
                Emergency contact details are restricted. Contact HR for updates.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Employment Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employment Details</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-ink-100">
          <FieldRow
            label="Department"
            value={employee.departmentName}
            icon={<Briefcase className="h-4 w-4" />}
          />
          <FieldRow
            label="Position"
            value={employee.positionName}
            icon={<Briefcase className="h-4 w-4" />}
          />
          <FieldRow
            label="Manager"
            value={employee.managerName}
            icon={<User className="h-4 w-4" />}
          />
          <FieldRow
            label="Hire Date"
            value={formatDate(employee.hireDate)}
            icon={<Calendar className="h-4 w-4" />}
          />
          <FieldRow label="Employment Type" value={employee.employmentType} />
          <FieldRow
            label="Salary"
            value={
              canAccessSalary
                ? employee.salary
                  ? `$${employee.salary.toLocaleString()}`
                  : '—'
                : null
            }
            icon={<Briefcase className="h-4 w-4" />}
          />
          <div className="flex items-start justify-between gap-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Briefcase className="h-4 w-4" />
              Status
            </div>
            <Badge
              variant={employee.status === 'Active' ? 'default' : 'secondary'}
              className={
                employee.status === 'Active'
                  ? 'bg-green-100 text-green-700'
                  : employee.status === 'On Leave'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-700'
              }
            >
              {employee.status}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
