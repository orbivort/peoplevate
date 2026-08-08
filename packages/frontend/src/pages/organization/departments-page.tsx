import { motion } from 'framer-motion';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  createDepartment,
  deleteDepartment,
  updateDepartment,
  useDepartments,
} from '@/data/data-layer';
import type { Department } from '@/types';
import { cn } from '@/lib/utils';

interface DeptFormValues {
  name: string;
  description: string;
  parentId: string | 'none';
}

export function DepartmentsPage() {
  const { data: sourceDepartments } = useDepartments();
  // Local editable list seeded from the data layer (mock or real API). Kept in
  // state so create/edit/delete UX continues to work regardless of source.
  const [departments, setDepartments] = useState<Department[]>(sourceDepartments);
  useEffect(() => {
    queueMicrotask(() => setDepartments(sourceDepartments));
  }, [sourceDepartments]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // expand roots by default
    const roots = sourceDepartments.filter((d) => !d.parentId);
    return new Set(roots.map((d) => d.id));
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<DeptFormValues>({
    name: '',
    description: '',
    parentId: 'none',
  });
  const [error, setError] = useState<string | null>(null);

  // Build tree
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Department[]>();
    for (const d of departments) {
      const key = d.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(d);
    }
    return byParent;
  }, [departments]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = (parentId?: string) => {
    setEditing(null);
    setForm({ name: '', description: '', parentId: parentId ?? 'none' });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (dept: Department) => {
    setEditing(dept);
    setForm({
      name: dept.name,
      description: dept.description ?? '',
      parentId: dept.parentId ?? 'none',
    });
    setError(null);
    setDialogOpen(true);
  };

  // Delete confirmation dialog state (separate from the create/edit dialog so
  // delete errors never surface inside the create form).
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteClick = (dept: Department) => {
    if (dept.positionCount > 0 || dept.employeeCount > 0) {
      setDeleteError(
        `Cannot delete "${dept.name}" — it has ${dept.positionCount} position(s) and ${dept.employeeCount} employee(s) assigned. Remove or reassign them first.`,
      );
      setDeleteTarget(dept);
      return;
    }
    setDeleteError(null);
    setDeleteTarget(dept);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setDeleteError(null);
    try {
      await deleteDepartment(deleteTarget.id);
      setDepartments((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete department. Please try again.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Department name is required.');
      return;
    }
    // Circular reference check
    if (editing && form.parentId !== 'none') {
      const wouldCycle = (parentId: string, selfId: string): boolean => {
        let cur: string | null = parentId;
        while (cur) {
          if (cur === selfId) return true;
          const node = departments.find((d) => d.id === cur);
          cur = node?.parentId ?? null;
        }
        return false;
      };
      if (wouldCycle(form.parentId, editing.id)) {
        setError('Circular reference detected: a department cannot be its own ancestor.');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      parentId: form.parentId === 'none' ? null : form.parentId,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateDepartment(editing.id, payload);
        setDepartments((prev) =>
          prev.map((d) =>
            d.id === editing.id
              ? {
                  ...d,
                  name: payload.name,
                  description: payload.description,
                  parentId: payload.parentId,
                }
              : d,
          ),
        );
      } else {
        // Use the department returned by the backend so local state holds the
        // real DB id — this keeps subsequent edit/delete calls working.
        const created = await createDepartment(payload);
        setDepartments((prev) => [...prev, created]);
        if (created.parentId) {
          setExpanded((prev) => new Set(prev).add(created.parentId as string));
        }
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save department. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderNode = (dept: Department, depth: number) => {
    const children = tree.get(dept.id) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(dept.id);
    return (
      <div key={dept.id}>
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'group flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-ink-200 hover:bg-ink-50',
          )}
          style={{ paddingLeft: depth * 24 + 8 }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleExpand(dept.id)}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded text-ink-400 transition-colors',
              hasChildren ? 'hover:bg-ink-200 hover:text-ink-700' : 'opacity-30',
            )}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )
            ) : (
              <span className="h-1 w-1 rounded-full bg-ink-300" />
            )}
          </button>

          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700">
            <Building2 className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-ink-900">{dept.name}</span>
              {depth === 0 && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Root
                </Badge>
              )}
            </div>
            {dept.description && (
              <p className="truncate text-xs text-ink-500">{dept.description}</p>
            )}
          </div>

          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            <span className="w-24 text-xs text-ink-500">{dept.positionCount} positions</span>
            <span className="w-28 text-xs text-ink-500">{dept.employeeCount} employees</span>
          </div>

          <div className="flex w-24 shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openCreate(dept.id)}
              title="Add sub-department"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => openEdit(dept)} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleDeleteClick(dept)}
              title="Delete"
              disabled={deletingId === dept.id}
              className="text-red-500 hover:text-red-600"
            >
              {deletingId === dept.id ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </motion.div>

        {hasChildren && isExpanded && (
          <div className="space-y-0.5">{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const roots = tree.get(null) ?? [];

  return (
    <div>
      <PageHeader
        title="Departments"
        description="Organize your company into a hierarchical structure of departments."
        actions={
          <Button onClick={() => openCreate()}>
            <Plus className="h-4 w-4" />
            Add department
          </Button>
        }
      />

      <Card className="p-2">
        {roots.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="Create your first department to start organizing your organization structure."
            action={
              <Button onClick={() => openCreate()}>
                <Plus className="h-4 w-4" />
                Add department
              </Button>
            }
          />
        ) : (
          <div className="space-y-0.5">
            {/* Header row */}
            <div className="flex items-center gap-2 border-b border-ink-200 px-2 pb-2">
              <div className="h-5 w-5" />
              <div className="w-8" />
              <div className="flex-1 text-xs font-semibold tracking-wide text-ink-400 uppercase">
                Name
              </div>
              <div className="hidden items-center gap-4 sm:flex">
                <span className="w-24 text-xs font-semibold tracking-wide text-ink-400 uppercase">
                  Positions
                </span>
                <span className="w-28 text-xs font-semibold tracking-wide text-ink-400 uppercase">
                  Employees
                </span>
              </div>
              <div className="w-24" />
            </div>
            {roots.map((root) => renderNode(root, 0))}
          </div>
        )}
      </Card>

      {/* Tree visualization note */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-xs text-ink-500">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <p>
          Departments support unlimited nesting via parent relationships. Circular references are
          detected and rejected at save time. Deletion is blocked when a department has active
          positions or employees.
        </p>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit department' : 'New department'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the department details. Changes are audit-logged.'
                : 'Create a new department in your organization structure.'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dept-name">Name *</Label>
              <Input
                id="dept-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Customer Success"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-desc">Description</Label>
              <Textarea
                id="dept-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional — what does this department do?"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Parent department</Label>
              <Select
                value={form.parentId}
                onValueChange={(v) => setForm((f) => ({ ...f, parentId: v as string | 'none' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (root department)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (root department)</SelectItem>
                  {departments
                    .filter((d) => d.id !== editing?.id)
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create department'}
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
            <DialogTitle>Delete department</DialogTitle>
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
