import { motion } from 'framer-motion';
import { ClipboardList, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import {
  createPosition,
  deletePosition,
  updatePosition,
  useDepartments,
  usePositions,
} from '@/data/data-layer';
import type { Position } from '@/types';

interface PosFormValues {
  name: string;
  grade: string;
  description: string;
  departmentId: string;
}

export function PositionsPage() {
  const { data: seedDepartments } = useDepartments();
  const { data: sourcePositions } = usePositions();
  const [positions, setPositions] = useState<Position[]>(sourcePositions);
  useEffect(() => {
    queueMicrotask(() => setPositions(sourcePositions));
  }, [sourcePositions]);
  const [filterDept, setFilterDept] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [form, setForm] = useState<PosFormValues>({
    name: '',
    grade: '',
    description: '',
    departmentId: seedDepartments[0]?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return positions.filter((p) => {
      if (filterDept !== 'all' && p.departmentId !== filterDept) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [positions, filterDept, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      grade: '',
      description: '',
      departmentId: filterDept !== 'all' ? filterDept : (seedDepartments[0]?.id ?? ''),
    });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (pos: Position) => {
    setEditing(pos);
    setForm({
      name: pos.name,
      grade: pos.grade ?? '',
      description: pos.description ?? '',
      departmentId: pos.departmentId,
    });
    setError(null);
    setDialogOpen(true);
  };

  // Delete confirmation dialog state (separate from the create/edit dialog so
  // delete errors never surface inside the create form).
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteClick = (pos: Position) => {
    if (pos.employeeCount > 0) {
      setDeleteError(
        `Cannot delete "${pos.name}" — ${pos.employeeCount} employee(s) are assigned to this position. Reassign them first.`,
      );
      setDeleteTarget(pos);
      return;
    }
    setDeleteError(null);
    setDeleteTarget(pos);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setDeleteError(null);
    try {
      await deletePosition(deleteTarget.id);
      setPositions((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete position. Please try again.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Position name is required.');
      return;
    }
    if (!form.departmentId) {
      setError('A department must be selected.');
      return;
    }
    if (!form.grade.trim()) {
      setError('Grade / Level is required.');
      return;
    }
    const dept = seedDepartments.find((d) => d.id === form.departmentId);
    const payload = {
      name: form.name.trim(),
      grade: form.grade.trim(),
      description: form.description.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editing) {
        await updatePosition(editing.id, payload);
        setPositions((prev) =>
          prev.map((p) =>
            p.id === editing.id
              ? {
                  ...p,
                  name: payload.name,
                  grade: payload.grade,
                  description: payload.description,
                  departmentId: form.departmentId,
                  departmentName: dept?.name ?? p.departmentName,
                }
              : p,
          ),
        );
      } else {
        // Use the position returned by the backend so local state holds the
        // real DB id — this keeps subsequent edit/delete calls working.
        const created = await createPosition({
          ...payload,
          departmentId: form.departmentId,
        });
        setPositions((prev) => [
          ...prev,
          {
            ...created,
            departmentName: dept?.name ?? created.departmentName,
          },
        ]);
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save position. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Positions"
        description="Define job titles and associate them with departments."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add position
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Search positions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="sm:w-64">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {seedDepartments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-sm text-ink-500">
            {filtered.length} of {positions.length} positions
          </div>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No positions found"
            description="Adjust your filters or create a new position to get started."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add position
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((pos, i) => (
                <motion.tr
                  key={pos.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                  className="group border-b border-ink-200 transition-colors hover:bg-ink-50/60"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                        <ClipboardList className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-medium text-ink-900">{pos.name}</div>
                        {pos.description && (
                          <div className="max-w-md truncate text-xs text-ink-500">
                            {pos.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{pos.departmentName}</Badge>
                  </TableCell>
                  <TableCell>
                    {pos.grade ? (
                      <span className="font-mono text-xs text-ink-600">{pos.grade}</span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1 text-sm text-ink-600">
                      <Users className="h-3.5 w-3.5 text-ink-400" />
                      {pos.employeeCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(pos)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteClick(pos)}
                        disabled={deletingId === pos.id}
                        className="text-red-500 hover:text-red-600"
                      >
                        {deletingId === pos.id ? (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <p>
          Positions are linked to departments via a foreign key, so renaming a position
          automatically updates all referencing employee records. Deletion is blocked when employees
          are assigned.
        </p>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit position' : 'New position'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the position details.'
                : 'Create a new job title and assign it to a department.'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pos-name">Title *</Label>
              <Input
                id="pos-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Senior Product Designer"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="pos-grade">Grade / Level *</Label>
                <Input
                  id="pos-grade"
                  value={form.grade}
                  onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                  placeholder="e.g. L6"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Department *</Label>
                <Select
                  value={form.departmentId}
                  onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {seedDepartments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-desc">Description</Label>
              <Textarea
                id="pos-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional — responsibilities and scope."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create position'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete position</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `Delete "${deleteTarget.name}"? This action cannot be undone.` : ''}
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {deleteError}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingId !== null}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deletingId !== null}>
              {deletingId ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
