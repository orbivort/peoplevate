import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectFormDialog, type ProjectFormDialogProps } from './project-form-dialog';
import type { Project } from '@/types/timesheet';

const project: Project = {
  id: 'p-web',
  code: 'WEB-002',
  name: 'Website Redesign',
  description: 'Marketing site refresh',
  client: 'Acme Corp',
  isBillable: true,
  startDate: '2026-03-01T00:00:00.000Z',
  endDate: '2026-09-30T00:00:00.000Z',
  isActive: true,
  taskCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderDialog(overrides: Partial<ProjectFormDialogProps> = {}) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onSubmit = overrides.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ProjectFormDialog
      open={overrides.open ?? true}
      project={overrides.project ?? null}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />,
  );
  return { ...view, onOpenChange, onSubmit };
}

/** Fill the two required fields. */
function fillRequired(code = 'WEB-002', name = 'Website Redesign') {
  fireEvent.change(screen.getByLabelText('Code *'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: name } });
}

describe('ProjectFormDialog', () => {
  it('renders an empty create form', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code *')).toHaveValue('');
    expect(screen.getByLabelText('Name *')).toHaveValue('');
    expect(screen.getByLabelText('Client')).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Start date')).toHaveValue('');
    expect(screen.getByLabelText('End date')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /billable project/i })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
  });

  it('prefills the form when editing a project', () => {
    renderDialog({ project });

    expect(screen.getByRole('heading', { name: 'Edit project WEB-002' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code *')).toHaveValue('WEB-002');
    expect(screen.getByLabelText('Name *')).toHaveValue('Website Redesign');
    expect(screen.getByLabelText('Client')).toHaveValue('Acme Corp');
    expect(screen.getByLabelText('Description')).toHaveValue('Marketing site refresh');
    // ISO timestamps are sliced to the value native date inputs expect.
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-09-30');
    expect(screen.getByRole('checkbox', { name: /billable project/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('requires both a code and a name', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(screen.getByText('Project code and name are required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('treats whitespace-only values as missing', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText('Code *'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '  ' } });
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(screen.getByText('Project code and name are required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects an end date that is before the start date', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    fillRequired();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-10' } });
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(screen.getByText('The end date cannot be before the start date.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts an end date equal to the start date', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    fillRequired();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-20' } });
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('trims values, sends nulls for blank optionals, then closes', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText('Code *'), { target: { value: '  WEB-002  ' } });
    fireEvent.change(screen.getByLabelText('Name *'), {
      target: { value: '  Website Redesign  ' },
    });
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        code: 'WEB-002',
        name: 'Website Redesign',
        client: null,
        description: null,
        isBillable: false,
        startDate: null,
        endDate: null,
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('collects every populated field on submit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    fillRequired('ERP-001', 'ERP Migration');
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: ' Acme Corp ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: ' Phase one ' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-30' } });
    await user.click(screen.getByRole('checkbox', { name: /billable project/i }));
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        code: 'ERP-001',
        name: 'ERP Migration',
        client: 'Acme Corp',
        description: 'Phase one',
        isBillable: true,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      }),
    );
  });

  it('submits the edited project and closes', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = renderDialog({ project });

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Website Refresh' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'WEB-002',
          name: 'Website Refresh',
          client: 'Acme Corp',
          isBillable: true,
          startDate: '2026-03-01',
          endDate: '2026-09-30',
        }),
      ),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows the server error and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Project code already exists.'));
    const { onOpenChange } = renderDialog({ onSubmit });

    fillRequired();
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Project code already exists.')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled(),
    );
  });

  it('falls back to a generic message for non-Error failures', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue('boom');
    renderDialog({ onSubmit });

    fillRequired();
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Failed to save the project.')).toBeInTheDocument();
  });

  it('clears a previous error when a valid retry is submitted', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByText('Project code and name are required.')).toBeInTheDocument();

    fillRequired();
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Project code and name are required.')).not.toBeInTheDocument();
  });

  it('closes without submitting when cancelled', async () => {
    const user = userEvent.setup();
    const { onSubmit, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the saving state and disables the primary button while in flight', async () => {
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { onOpenChange } = renderDialog({ onSubmit });

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();

    await act(async () => {
      resolveSubmit();
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
