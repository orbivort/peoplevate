import { motion } from 'framer-motion';
import {
  KeyRound,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAuth } from '@/contexts/auth-context';
import {
  adminResetPassword,
  changeUserRole,
  changeUserStatus,
  deleteUser,
  inviteUser,
  isRealBackend,
  useEmployees,
  useUsers,
} from '@/data/data-layer';
import { cn, initials } from '@/lib/utils';
import type { Role, User } from '@/types';

const roleStyles: Record<Role, string> = {
  Admin: 'bg-purple-100 text-purple-700',
  'HR Manager': 'bg-accent-100 text-accent-800',
  Manager: 'bg-blue-100 text-blue-700',
  Employee: 'bg-ink-100 text-ink-700',
};

const statusStyles: Record<User['status'], string> = {
  active: 'bg-accent-100 text-accent-800',
  deactivated: 'bg-red-100 text-red-700',
  pending_setup: 'bg-amber-100 text-amber-700',
};

const ALL_ROLES: Role[] = ['Admin', 'HR Manager', 'Manager', 'Employee'];

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const { data: seedUsers } = useUsers();
  const { data: employees } = useEmployees();
  const [users, setUsers] = useState<User[]>(seedUsers);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'Employee' as Role,
    employeeId: '',
  });
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetDialogFor, setResetDialogFor] = useState<User | null>(null);
  const [resetting, setResetting] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setUsers(seedUsers));
  }, [seedUsers]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const emp = employees.find((e) => e.id === u.employeeId);
        const name = emp ? `${emp.firstName} ${emp.lastName}` : '';
        return (
          u.email.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, roleFilter, search, employees]);

  // In real mode every write must hit the backend so the DB stays in sync.
  // In mock mode we keep the previous behaviour of updating local state only.
  const updateRole = async (id: string, role: Role) => {
    setActionError(null);
    const prev = users;
    setUsers((u) => u.map((x) => (x.id === id ? { ...x, role } : x)));
    try {
      if (isRealBackend()) {
        await changeUserRole(id, role);
      }
    } catch (err) {
      setUsers(prev);
      setActionError(
        err instanceof Error ? err.message : 'Failed to update role. Please try again.',
      );
    }
  };

  const toggleStatus = async (id: string) => {
    setActionError(null);
    const target = users.find((u) => u.id === id);
    if (!target) return;
    const nextStatus: User['status'] = target.status === 'active' ? 'deactivated' : 'active';
    const prev = users;
    setUsers((u) => u.map((x) => (x.id === id ? { ...x, status: nextStatus } : x)));
    try {
      if (isRealBackend()) {
        await changeUserStatus(id, nextStatus);
      }
    } catch (err) {
      setUsers(prev);
      setActionError(
        err instanceof Error ? err.message : 'Failed to update status. Please try again.',
      );
    }
  };

  const handleInvite = async () => {
    setInviteError(null);
    if (!inviteForm.email.trim()) {
      setInviteError('Email is required.');
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === inviteForm.email.toLowerCase())) {
      setInviteError('A user with this email already exists.');
      return;
    }
    setSendingInvite(true);
    try {
      if (isRealBackend()) {
        await inviteUser({
          email: inviteForm.email,
          role: inviteForm.role,
          employeeId: inviteForm.employeeId || undefined,
        });
      }
      const newUser: User = {
        id: `u-${Date.now()}`,
        email: inviteForm.email,
        role: inviteForm.role,
        status: 'pending_setup',
        employeeId: inviteForm.employeeId || undefined,
      };
      setUsers((prev) => [...prev, newUser]);
      setInviteOpen(false);
      setInviteForm({ email: '', role: 'Employee', employeeId: '' });
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : 'Failed to send invitation. Please try again.',
      );
    } finally {
      setSendingInvite(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetDialogFor) return;
    setResetting(true);
    try {
      if (isRealBackend()) {
        await adminResetPassword(resetDialogFor.id);
      }
      setResetDialogFor(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to send reset link. Please try again.',
      );
      setResetDialogFor(null);
    } finally {
      setResetting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (isRealBackend()) {
        await deleteUser(deleteTarget.id);
      }
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to delete user. Please try again.',
      );
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const counts = {
    all: users.length,
    Admin: users.filter((u) => u.role === 'Admin').length,
    'HR Manager': users.filter((u) => u.role === 'HR Manager').length,
    Manager: users.filter((u) => u.role === 'Manager').length,
    Employee: users.filter((u) => u.role === 'Employee').length,
  };

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage user accounts, roles, and access permissions across the system."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4" />
            Invite user
          </Button>
        }
      />

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(['Admin', 'HR Manager', 'Manager', 'Employee'] as Role[]).map((role) => (
          <Card key={role}>
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg',
                  roleStyles[role],
                )}
              >
                {role === 'Admin' ? (
                  <ShieldCheck className="h-5 w-5" />
                ) : role === 'HR Manager' ? (
                  <Shield className="h-5 w-5" />
                ) : (
                  <Users className="h-5 w-5" />
                )}
              </div>
              <div>
                <p className="text-2xl font-semibold text-ink-900">{counts[role]}</p>
                <p className="text-xs text-ink-500">{role}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search by email, name, or role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Users table */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={UserCog}
            title="No users found"
            description="Try adjusting your search or filters, or invite a new user."
          />
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Linked employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[200px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u, i) => {
                  const emp = employees.find((e) => e.id === u.employeeId);
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <motion.tr
                      key={u.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                      className="group"
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-ink-900 text-xs text-ink-50">
                              {initials(emp ? `${emp.firstName} ${emp.lastName}` : u.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium text-ink-900">
                              {emp ? `${emp.firstName} ${emp.lastName}` : '—'}
                              {isSelf && (
                                <span className="ml-2 text-[10px] font-normal text-ink-400">
                                  (you)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-ink-500">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          onValueChange={(v) => updateRole(u.id, v as Role)}
                          disabled={isSelf}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-ink-600">
                        {emp ? (
                          <span>
                            {emp.employeeNo} · {emp.positionName}
                          </span>
                        ) : (
                          <span className="text-ink-400">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn('border-transparent text-[10px]', statusStyles[u.status])}
                        >
                          {u.status === 'active' && 'Active'}
                          {u.status === 'deactivated' && 'Deactivated'}
                          {u.status === 'pending_setup' && 'Pending setup'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setResetDialogFor(u)}
                            title="Reset password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Reset
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(
                              u.status === 'active'
                                ? 'text-red-500 hover:text-red-700'
                                : 'text-accent-600 hover:text-accent-700',
                            )}
                            onClick={() => toggleStatus(u.id)}
                            disabled={isSelf}
                            title={u.status === 'active' ? 'Deactivate' : 'Activate'}
                          >
                            {u.status === 'active' ? (
                              <>
                                <ShieldOff className="h-3.5 w-3.5" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Activate
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(u)}
                            disabled={isSelf}
                            title="Delete user"
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </motion.tr>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              Send an invitation to a new user. They will receive a setup link via email.
            </DialogDescription>
          </DialogHeader>
          {inviteError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {inviteError}
            </div>
          )}
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="newuser@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v as Role }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Link to employee (optional)</Label>
              <Select
                value={inviteForm.employeeId}
                onValueChange={(v) => setInviteForm((f) => ({ ...f, employeeId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter((e) => e.status !== 'Terminated')
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName} — {e.employeeNo}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={sendingInvite}>
              <Plus className="h-4 w-4" />
              {sendingInvite ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetDialogFor} onOpenChange={(open) => !open && setResetDialogFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-accent-600" />
              Reset password
            </DialogTitle>
            <DialogDescription>
              A password reset link will be sent to{' '}
              <span className="font-medium text-ink-700">{resetDialogFor?.email}</span>. The user
              will need to set a new password on next login.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogFor(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              <KeyRound className="h-4 w-4" />
              {resetting ? 'Sending…' : 'Send reset link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete user confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium text-ink-700">{deleteTarget?.email}</span>? This
              will remove their access and revoke active sessions. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
