import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { projectRepo } from '@/lib/timesheet-api';
import { cn } from '@/lib/utils';
import type { ProjectAdminStats, ProjectTask } from '@/types/timesheet';

export interface ProjectTasksPanelProps {
  project: ProjectAdminStats;
  /** Notifies the parent to refresh its stats (task counts). */
  onChanged: () => void;
}

/**
 * Expandable task management panel for one project: add, rename, activate or
 * deactivate, and delete tasks — with 409 "has timesheet entries" errors
 * surfaced inline.
 */
export function ProjectTasksPanel({ project, onChanged }: ProjectTasksPanelProps) {
  const { showToast, toastElement } = useToast();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskName, setNewTaskName] = useState('');
  const [busy, setBusy] = useState(false);

  const [renaming, setRenaming] = useState<ProjectTask | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ProjectTask | null>(null);

  // The initial load is defined inside the effect (cancelled-guarded) so no
  // setState can run synchronously during the effect; `reload` re-uses the
  // same logic after task mutations.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await projectRepo.listTasks(project.id, true);
        if (!cancelled) setTasks(list);
      } catch (err) {
        if (!cancelled) {
          showToast('error', err instanceof Error ? err.message : 'Failed to load tasks.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [project.id, showToast]);

  const reload = useCallback(async () => {
    try {
      const list = await projectRepo.listTasks(project.id, true);
      setTasks(list);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [project.id, showToast]);

  const handleAdd = useCallback(async () => {
    const trimmed = newTaskName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await projectRepo.createTask(project.id, { name: trimmed });
      setNewTaskName('');
      showToast('success', `Task “${trimmed}” added.`);
      await reload();
      onChanged();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to add the task.');
    } finally {
      setBusy(false);
    }
  }, [newTaskName, project.id, reload, onChanged, showToast]);

  const handleRenameConfirm = useCallback(async () => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await projectRepo.updateTask(project.id, renaming.id, { name: trimmed });
      setRenaming(null);
      showToast('success', 'Task renamed.');
      await reload();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to rename the task.');
    } finally {
      setBusy(false);
    }
  }, [renaming, renameValue, project.id, reload, showToast]);

  const handleToggleActive = useCallback(
    async (task: ProjectTask) => {
      setBusy(true);
      try {
        await projectRepo.updateTask(project.id, task.id, { isActive: !task.isActive });
        showToast('success', `Task “${task.name}” ${task.isActive ? 'deactivated' : 'activated'}.`);
        await reload();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to update the task.');
      } finally {
        setBusy(false);
      }
    },
    [project.id, reload, showToast],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await projectRepo.removeTask(project.id, deleting.id);
      setDeleting(null);
      showToast('success', 'Task deleted.');
      await reload();
      onChanged();
    } catch (err) {
      // 409 — the task is referenced by timesheet entries; keep the dialog
      // open and surface the server's explanation.
      showToast('error', err instanceof Error ? err.message : 'Failed to delete the task.');
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }, [deleting, project.id, reload, onChanged, showToast]);

  return (
    <div className="space-y-3">
      {toastElement}
      <div className="flex items-center gap-2">
        <Input
          placeholder="New task name…"
          value={newTaskName}
          onChange={(e) => setNewTaskName(e.target.value)}
          className="h-8 max-w-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
        />
        <Button size="sm" onClick={() => void handleAdd()} disabled={busy || !newTaskName.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Add task
        </Button>
      </div>

      {loading ? (
        <div className="flex h-16 items-center gap-2 text-sm text-ink-500">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-ink-400">
          No tasks yet — add one so employees can log more granular hours.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'text-sm font-medium',
                    task.isActive ? 'text-ink-800' : 'text-ink-400 line-through',
                  )}
                >
                  {task.name}
                </span>
                <Badge
                  className={
                    task.isActive
                      ? 'border-transparent bg-accent-100 text-accent-800'
                      : 'border-transparent bg-ink-100 text-ink-500'
                  }
                >
                  {task.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(task);
                    setRenameValue(task.name);
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleToggleActive(task)}
                >
                  {task.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete task ${task.name}`}
                  className="text-ink-400 hover:text-red-600"
                  disabled={busy}
                  onClick={() => setDeleting(task)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Rename dialog */}
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename task</DialogTitle>
            <DialogDescription>Task names must be unique within the project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Input
              aria-label="Task name"
              value={renameValue}
              maxLength={100}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={() => void handleRenameConfirm()} disabled={busy}>
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete task?</DialogTitle>
            <DialogDescription>
              {deleting &&
                `“${deleting.name}” will be removed from the catalog. Tasks referenced by timesheet entries cannot be deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteConfirm()} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
