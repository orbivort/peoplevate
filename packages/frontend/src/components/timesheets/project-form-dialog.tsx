import { AlertCircle } from 'lucide-react';
import { useState } from 'react';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CreateProjectPayload, Project, UpdateProjectPayload } from '@/types/timesheet';

export interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this project instead of creating one. */
  project?: Project | null;
  onSubmit: (payload: CreateProjectPayload | UpdateProjectPayload) => Promise<void>;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project = null,
  onSubmit,
}: ProjectFormDialogProps) {
  // Initialized once from props: the parent mounts this dialog only while it
  // is open, so state resets naturally on every open (no reset effects).
  const [code, setCode] = useState(project?.code ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [client, setClient] = useState(project?.client ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [isBillable, setIsBillable] = useState(project?.isBillable ?? false);
  const [startDate, setStartDate] = useState(
    project?.startDate ? project.startDate.slice(0, 10) : '',
  );
  const [endDate, setEndDate] = useState(project?.endDate ? project.endDate.slice(0, 10) : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!code.trim() || !name.trim()) {
      setError('Project code and name are required.');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setError('The end date cannot be before the start date.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        code: code.trim(),
        name: name.trim(),
        client: client.trim() || null,
        description: description.trim() || null,
        isBillable,
        startDate: startDate || null,
        endDate: endDate || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the project.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? `Edit project ${project.code}` : 'Create project'}</DialogTitle>
          <DialogDescription>
            Projects form the catalog employees log their working hours against.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-code">Code *</Label>
              <Input
                id="project-code"
                value={code}
                maxLength={20}
                placeholder="e.g. ERP-001"
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name *</Label>
              <Input
                id="project-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-client">Client</Label>
            <Input
              id="project-client"
              value={client}
              maxLength={100}
              placeholder="Optional client name"
              onChange={(e) => setClient(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-start">Start date</Label>
              <Input
                id="project-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-end">End date</Label>
              <Input
                id="project-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-ink-300 accent-ink-900"
            />
            Billable project
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
