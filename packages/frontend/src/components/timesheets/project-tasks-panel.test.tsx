import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTasksMock = vi.fn();
const createTaskMock = vi.fn();
const updateTaskMock = vi.fn();
const removeTaskMock = vi.fn();

vi.mock('@/lib/timesheet-api', () => ({
  projectRepo: {
    listTasks: (...args: unknown[]) => listTasksMock(...args),
    createTask: (...args: unknown[]) => createTaskMock(...args),
    updateTask: (...args: unknown[]) => updateTaskMock(...args),
    removeTask: (...args: unknown[]) => removeTaskMock(...args),
  },
}));

import { ProjectTasksPanel } from './project-tasks-panel';
import type { ProjectAdminStats, ProjectTask } from '@/types/timesheet';

const project: ProjectAdminStats = {
  id: 'p-erp',
  code: 'ERP-001',
  name: 'ERP Migration',
  description: null,
  client: null,
  isBillable: true,
  startDate: null,
  endDate: null,
  isActive: true,
  taskCount: 2,
  entryCount: 14,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const activeTask: ProjectTask = {
  id: 't-impl',
  projectId: 'p-erp',
  name: 'Implementation',
  isActive: true,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const inactiveTask: ProjectTask = {
  ...activeTask,
  id: 't-docs',
  name: 'Documentation',
  isActive: false,
};

function renderPanel(overrides: { project?: ProjectAdminStats; onChanged?: () => void } = {}) {
  const onChanged = overrides.onChanged ?? vi.fn();
  const view = render(
    <ProjectTasksPanel project={overrides.project ?? project} onChanged={onChanged} />,
  );
  return { ...view, onChanged };
}

/** The first row's Rename button (tasks render in list order). */
function firstRenameButton(): HTMLElement {
  const [first] = screen.getAllByRole('button', { name: 'Rename' });
  if (!first) throw new Error('No rename button rendered');
  return first;
}

beforeEach(() => {
  vi.resetAllMocks();
  listTasksMock.mockResolvedValue([activeTask, inactiveTask]);
  createTaskMock.mockResolvedValue(activeTask);
  updateTaskMock.mockResolvedValue(activeTask);
  removeTaskMock.mockResolvedValue({ message: 'Task deleted' });
});

describe('ProjectTasksPanel', () => {
  describe('loading the catalog', () => {
    it('shows a loading indicator until the tasks resolve', async () => {
      let release!: (tasks: ProjectTask[]) => void;
      listTasksMock.mockReturnValueOnce(
        new Promise<ProjectTask[]>((resolve) => {
          release = resolve;
        }),
      );
      renderPanel();

      expect(screen.getByText(/loading tasks/i)).toBeInTheDocument();
      expect(listTasksMock).toHaveBeenCalledWith('p-erp', true);

      await act(async () => {
        release([activeTask]);
      });

      expect(screen.getByText('Implementation')).toBeInTheDocument();
      expect(screen.queryByText(/loading tasks/i)).not.toBeInTheDocument();
    });

    it('lists active and inactive tasks with the right affordances', async () => {
      renderPanel();

      expect(await screen.findByText('Implementation')).toBeInTheDocument();
      expect(screen.getByText('Documentation')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Inactive')).toBeInTheDocument();
      expect(screen.getByText('Documentation')).toHaveClass('line-through');
      expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    });

    it('shows an empty state when the project has no tasks', async () => {
      listTasksMock.mockResolvedValue([]);
      renderPanel();

      expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    });

    it('surfaces a load failure and stops loading', async () => {
      listTasksMock.mockRejectedValue(new Error('Network down'));
      renderPanel();

      expect(await screen.findByRole('status')).toHaveTextContent('Network down');
      expect(screen.queryByText(/loading tasks/i)).not.toBeInTheDocument();
    });

    it('uses a generic message for a non-Error load failure', async () => {
      listTasksMock.mockRejectedValue('nope');
      renderPanel();

      expect(await screen.findByRole('status')).toHaveTextContent('Failed to load tasks.');
    });

    it('reloads the catalog when the managed project changes', async () => {
      const onChanged = vi.fn();
      const webProject: ProjectAdminStats = {
        ...project,
        id: 'p-web',
        code: 'WEB-002',
        name: 'Website Redesign',
      };
      const webTask: ProjectTask = {
        ...activeTask,
        id: 't-web',
        projectId: 'p-web',
        name: 'Design',
      };
      listTasksMock.mockResolvedValueOnce([activeTask]).mockResolvedValueOnce([webTask]);

      const { rerender } = render(<ProjectTasksPanel project={project} onChanged={onChanged} />);
      expect(await screen.findByText('Implementation')).toBeInTheDocument();

      rerender(<ProjectTasksPanel project={webProject} onChanged={onChanged} />);

      expect(await screen.findByText('Design')).toBeInTheDocument();
      expect(listTasksMock).toHaveBeenLastCalledWith('p-web', true);
      expect(screen.queryByText('Implementation')).not.toBeInTheDocument();
    });
  });

  describe('adding a task', () => {
    it('adds a trimmed task, reloads and notifies the parent', async () => {
      const user = userEvent.setup();
      const { onChanged } = renderPanel();
      await screen.findByText('Implementation');

      const input = screen.getByPlaceholderText(/new task name/i);
      await user.type(input, '  Code review  ');
      await user.click(screen.getByRole('button', { name: /add task/i }));

      await waitFor(() =>
        expect(createTaskMock).toHaveBeenCalledWith('p-erp', { name: 'Code review' }),
      );
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(listTasksMock).toHaveBeenCalledTimes(2);
      expect(input).toHaveValue('');
      expect(screen.getByRole('status')).toHaveTextContent(/added/i);
    });

    it('adds a task when Enter is pressed', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.type(screen.getByPlaceholderText(/new task name/i), 'Refinement{Enter}');

      await waitFor(() =>
        expect(createTaskMock).toHaveBeenCalledWith('p-erp', { name: 'Refinement' }),
      );
    });

    it('keeps the add button disabled until the name is non-blank', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      const button = screen.getByRole('button', { name: /add task/i });
      expect(button).toBeDisabled();

      await user.type(screen.getByPlaceholderText(/new task name/i), '   ');
      expect(button).toBeDisabled();

      await user.type(screen.getByPlaceholderText(/new task name/i), 'X');
      expect(button).toBeEnabled();
    });

    it('reports an add failure and does not notify the parent', async () => {
      const user = userEvent.setup();
      createTaskMock.mockRejectedValue(new Error('Task already exists.'));
      const { onChanged } = renderPanel();
      await screen.findByText('Implementation');

      await user.type(screen.getByPlaceholderText(/new task name/i), 'Duplicate');
      await user.click(screen.getByRole('button', { name: /add task/i }));

      expect(await screen.findByRole('status')).toHaveTextContent('Task already exists.');
      expect(onChanged).not.toHaveBeenCalled();
      expect(listTasksMock).toHaveBeenCalledTimes(1);
    });

    it('uses a generic message when adding fails with a non-Error', async () => {
      const user = userEvent.setup();
      createTaskMock.mockRejectedValue('boom');
      renderPanel();
      await screen.findByText('Implementation');

      await user.type(screen.getByPlaceholderText(/new task name/i), 'Audit');
      await user.click(screen.getByRole('button', { name: /add task/i }));

      expect(await screen.findByRole('status')).toHaveTextContent('Failed to add the task.');
    });

    it('reports a failure of the post-mutation reload', async () => {
      const user = userEvent.setup();
      listTasksMock
        .mockResolvedValueOnce([activeTask])
        .mockRejectedValueOnce(new Error('Reload failed'));
      renderPanel();
      await screen.findByText('Implementation');

      await user.type(screen.getByPlaceholderText(/new task name/i), 'Audit');
      await user.click(screen.getByRole('button', { name: /add task/i }));

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reload failed'));
    });
  });

  describe('renaming a task', () => {
    it('renames a task through the dialog', async () => {
      const user = userEvent.setup();
      const { onChanged } = renderPanel();
      await screen.findByText('Implementation');

      await user.click(firstRenameButton());
      const nameInput = screen.getByLabelText('Task name');
      expect(nameInput).toHaveValue('Implementation');

      fireEvent.change(nameInput, { target: { value: '  Rollout  ' } });
      await user.click(screen.getByRole('button', { name: 'Save name' }));

      await waitFor(() =>
        expect(updateTaskMock).toHaveBeenCalledWith('p-erp', 't-impl', { name: 'Rollout' }),
      );
      await waitFor(() => expect(listTasksMock).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('status')).toHaveTextContent('Task renamed.');
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('ignores a blank rename and keeps the dialog open', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(firstRenameButton());
      fireEvent.change(screen.getByLabelText('Task name'), { target: { value: '   ' } });
      await user.click(screen.getByRole('button', { name: 'Save name' }));

      expect(updateTaskMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Task name')).toBeInTheDocument();
    });

    it('reports a rename failure and keeps the dialog open', async () => {
      const user = userEvent.setup();
      updateTaskMock.mockRejectedValue(new Error('Task name must be unique.'));
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(firstRenameButton());
      await user.click(screen.getByRole('button', { name: 'Save name' }));

      // The dialog stays open, which makes Radix mark the panel as
      // `aria-hidden`; the toast is therefore queried by text rather than role.
      expect(await screen.findByText('Task name must be unique.')).toBeInTheDocument();
      expect(screen.getByLabelText('Task name')).toBeInTheDocument();
    });

    it('uses a generic message when renaming fails with a non-Error', async () => {
      const user = userEvent.setup();
      updateTaskMock.mockRejectedValue('boom');
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(firstRenameButton());
      await user.click(screen.getByRole('button', { name: 'Save name' }));

      expect(await screen.findByText('Failed to rename the task.')).toBeInTheDocument();
    });

    it('cancels a rename without saving', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(firstRenameButton());
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(updateTaskMock).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Task name')).not.toBeInTheDocument();
    });

    it('closes the rename dialog on Escape', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(firstRenameButton());
      expect(screen.getByLabelText('Task name')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByLabelText('Task name')).not.toBeInTheDocument());
      expect(updateTaskMock).not.toHaveBeenCalled();
    });
  });

  describe('activating and deactivating', () => {
    it('deactivates an active task', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Deactivate' }));

      await waitFor(() =>
        expect(updateTaskMock).toHaveBeenCalledWith('p-erp', 't-impl', { isActive: false }),
      );
      await waitFor(() => expect(listTasksMock).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('status')).toHaveTextContent(/deactivated/i);
    });

    it('activates an inactive task', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Documentation');

      await user.click(screen.getByRole('button', { name: 'Activate' }));

      await waitFor(() =>
        expect(updateTaskMock).toHaveBeenCalledWith('p-erp', 't-docs', { isActive: true }),
      );
      expect(screen.getByRole('status')).toHaveTextContent('Documentation');
    });

    it('reports a toggle failure', async () => {
      const user = userEvent.setup();
      updateTaskMock.mockRejectedValue(new Error('Failed to reach the server.'));
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Deactivate' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Failed to reach the server.');
    });

    it('uses a generic message when toggling fails with a non-Error', async () => {
      const user = userEvent.setup();
      updateTaskMock.mockRejectedValue('boom');
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Deactivate' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Failed to update the task.');
    });
  });

  describe('deleting a task', () => {
    it('deletes a task after confirmation and notifies the parent', async () => {
      const user = userEvent.setup();
      const { onChanged } = renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Delete task Implementation' }));
      expect(await screen.findByText('Delete task?')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Delete task' }));

      await waitFor(() => expect(removeTaskMock).toHaveBeenCalledWith('p-erp', 't-impl'));
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(listTasksMock).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent('Task deleted.');
    });

    it('surfaces a 409 when the task is referenced by entries', async () => {
      const user = userEvent.setup();
      removeTaskMock.mockRejectedValue(
        Object.assign(new Error('Task is referenced by timesheet entries.'), { status: 409 }),
      );
      const { onChanged } = renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Delete task Implementation' }));
      await user.click(screen.getByRole('button', { name: 'Delete task' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Task is referenced by timesheet entries.',
      );
      expect(onChanged).not.toHaveBeenCalled();
      expect(listTasksMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Delete task?')).not.toBeInTheDocument();
    });

    it('uses a generic message when deleting fails with a non-Error', async () => {
      const user = userEvent.setup();
      removeTaskMock.mockRejectedValue('boom');
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Delete task Implementation' }));
      await user.click(screen.getByRole('button', { name: 'Delete task' }));

      expect(await screen.findByText('Failed to delete the task.')).toBeInTheDocument();
    });

    it('shows a busy label while the delete is in flight', async () => {
      const user = userEvent.setup();
      let release!: () => void;
      removeTaskMock.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ message: 'Task deleted' });
        }),
      );
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Delete task Implementation' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));

      const busy = await screen.findByRole('button', { name: 'Deleting…' });
      expect(busy).toBeDisabled();

      await act(async () => {
        release();
      });
      await waitFor(() => expect(removeTaskMock).toHaveBeenCalledTimes(1));
    });

    it('cancels a delete without calling the API', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Delete task Implementation' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(removeTaskMock).not.toHaveBeenCalled();
      expect(screen.queryByText('Delete task?')).not.toBeInTheDocument();
    });

    it('closes the delete confirmation on Escape', async () => {
      const user = userEvent.setup();
      renderPanel();
      await screen.findByText('Implementation');

      await user.click(screen.getByRole('button', { name: 'Delete task Implementation' }));
      expect(await screen.findByText('Delete task?')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByText('Delete task?')).not.toBeInTheDocument());
      expect(removeTaskMock).not.toHaveBeenCalled();
    });
  });
});
