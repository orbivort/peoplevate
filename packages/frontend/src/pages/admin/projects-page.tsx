import { ChevronDown, ChevronUp, FolderKanban, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { ProjectFormDialog } from '@/components/timesheets/project-form-dialog';
import { ProjectTasksPanel } from '@/components/timesheets/project-tasks-panel';
import { PageHeader } from '@/components/layout/page-header';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { projectRepo } from '@/lib/timesheet-api';
import { cn } from '@/lib/utils';
import type {
  CreateProjectPayload,
  ProjectAdminStats,
  UpdateProjectPayload,
} from '@/types/timesheet';

export function ProjectsPage() {
  const { showToast, toastElement } = useToast();

  const [projects, setProjects] = useState<ProjectAdminStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectAdminStats | null>(null);
  const [deleting, setDeleting] = useState<ProjectAdminStats | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // The initial load is defined inside the effect (cancelled-guarded) so no
  // setState can run synchronously during the effect; `refresh` re-uses the
  // same logic for the manual refresh button.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const stats = await projectRepo.adminStats();
        if (!cancelled) {
          setProjects(stats);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load projects.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const stats = await projectRepo.adminStats();
      setProjects(stats);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleActive = useCallback(
    async (project: ProjectAdminStats) => {
      setTogglingId(project.id);
      try {
        await projectRepo.update(project.id, { isActive: !project.isActive });
        showToast(
          'success',
          `Project ${project.code} ${project.isActive ? 'deactivated' : 'activated'}.`,
        );
        await refresh();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to update the project.');
      } finally {
        setTogglingId(null);
      }
    },
    [refresh, showToast],
  );

  const handleFormSubmit = useCallback(
    async (payload: CreateProjectPayload | UpdateProjectPayload) => {
      if (editingProject) {
        await projectRepo.update(editingProject.id, payload as UpdateProjectPayload);
        showToast('success', 'Project updated.');
      } else {
        await projectRepo.create(payload as CreateProjectPayload);
        showToast('success', 'Project created.');
      }
      await refresh();
    },
    [editingProject, refresh, showToast],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await projectRepo.remove(deleting.id);
      setDeleting(null);
      showToast('success', `Project ${deleting.code} deleted.`);
      if (expandedId === deleting.id) setExpandedId(null);
      await refresh();
    } catch (err) {
      // 409 — referenced by timesheet entries; keep the dialog open and show
      // the server's explanation.
      showToast('error', err instanceof Error ? err.message : 'Failed to delete the project.');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleting, expandedId, refresh, showToast]);

  return (
    <div>
      {toastElement}
      <PageHeader
        title="Projects"
        description="Manage the project and task catalog employees log their working hours against."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                setEditingProject(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New project
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          {loading && projects.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-ink-500">
              Loading projects…
            </div>
          ) : loadError ? (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create the first project so employees can start logging hours."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Tasks</span>
                  </TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Billable</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-center">Tasks</TableHead>
                  <TableHead className="text-center">Entries</TableHead>
                  <TableHead className="w-28">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => {
                  const expanded = expandedId === project.id;
                  return (
                    <Fragment key={project.id}>
                      <TableRow className={cn(expanded && 'bg-ink-50/60')}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={expanded ? `Hide tasks for ${project.code}` : `Show tasks for ${project.code}`}
                            onClick={() => setExpandedId(expanded ? null : project.id)}
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-semibold text-ink-900">
                          {project.code}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-ink-900">{project.name}</div>
                          {project.description && (
                            <div className="max-w-64 truncate text-xs text-ink-400" title={project.description}>
                              {project.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-ink-600">{project.client ?? '—'}</TableCell>
                        <TableCell>
                          {project.isBillable ? (
                            <Badge className="border-transparent bg-accent-100 text-accent-800">
                              Billable
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-ink-500">
                              Non-billable
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={togglingId === project.id}
                            onClick={() => void handleToggleActive(project)}
                          >
                            {project.isActive ? 'Active' : 'Inactive'}
                          </Button>
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm">{project.taskCount}</TableCell>
                        <TableCell className="text-center font-mono text-sm">{project.entryCount}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Edit project ${project.code}`}
                              onClick={() => {
                                setEditingProject(project);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete project ${project.code}`}
                              className="text-ink-400 hover:text-red-600"
                              onClick={() => setDeleting(project)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-ink-50/40 p-4">
                            <ProjectTasksPanel project={project} onChanged={() => void refresh()} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Mounted only while open, so the form state initializes fresh each time. */}
      {formOpen && (
        <ProjectFormDialog
          open
          onOpenChange={setFormOpen}
          project={editingProject}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* Delete-project confirmation */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              {deleting &&
                `${deleting.code} — ${deleting.name} will be removed from the catalog. Projects referenced by timesheet entries cannot be deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteConfirm()} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting…' : 'Delete project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
