import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const adminStatsMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const listTasksMock = vi.fn();
const createTaskMock = vi.fn();
const updateTaskMock = vi.fn();
const removeTaskMock = vi.fn();

vi.mock('@/lib/timesheet-api', () => ({
  projectRepo: {
    adminStats: (...args: unknown[]) => adminStatsMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    listTasks: (...args: unknown[]) => listTasksMock(...args),
    createTask: (...args: unknown[]) => createTaskMock(...args),
    updateTask: (...args: unknown[]) => updateTaskMock(...args),
    removeTask: (...args: unknown[]) => removeTaskMock(...args),
  },
}));

import { ProjectsPage } from './projects-page';
import type { ProjectAdminStats } from '@/types/timesheet';

const project: ProjectAdminStats = {
  id: 'p-erp',
  code: 'ERP-001',
  name: 'ERP Migration',
  description: 'Legacy ERP migration',
  client: 'Acme Corp',
  isBillable: true,
  startDate: null,
  endDate: null,
  isActive: true,
  taskCount: 2,
  entryCount: 14,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  adminStatsMock.mockResolvedValue([project]);
  createMock.mockResolvedValue(project);
  updateMock.mockResolvedValue(project);
  removeMock.mockResolvedValue({ message: 'Project deleted' });
  listTasksMock.mockResolvedValue([
    {
      id: 't-erp-impl',
      projectId: 'p-erp',
      name: 'Implementation',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]);
  createTaskMock.mockResolvedValue({});
  updateTaskMock.mockResolvedValue({});
  removeTaskMock.mockResolvedValue({ message: 'Task deleted' });
});

describe('ProjectsPage', () => {
  it('renders the catalog table with usage stats', async () => {
    render(<ProjectsPage />);

    expect(await screen.findByText('ERP-001')).toBeInTheDocument();
    expect(screen.getByText('ERP Migration')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getAllByText('Billable').length).toBeGreaterThan(0); // header + badge
    expect(screen.getByText('14')).toBeInTheDocument(); // entry count
  });

  it('shows an empty state when no projects exist', async () => {
    adminStatsMock.mockResolvedValue([]);
    render(<ProjectsPage />);

    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });

  it('expands a project to manage its tasks', async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await screen.findByText('ERP-001');
    await user.click(screen.getByRole('button', { name: /show tasks for erp-001/i }));

    expect(listTasksMock).toHaveBeenCalledWith('p-erp', true);
    expect(await screen.findByText('Implementation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/new task name/i)).toBeInTheDocument();
  });

  it('creates a project through the dialog', async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await screen.findByText('ERP-001');
    await user.click(screen.getByRole('button', { name: /new project/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Code *'), { target: { value: 'WEB-009' } });
    fireEvent.change(within(dialog).getByLabelText('Name *'), {
      target: { value: 'Website Redesign' },
    });
    await user.click(within(dialog).getByRole('button', { name: /create project/i }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'WEB-009', name: 'Website Redesign' }),
      ),
    );
  });

  it('deactivates a project via the active toggle', async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await screen.findByText('ERP-001');
    await user.click(screen.getByRole('button', { name: 'Active' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('p-erp', { isActive: false }));
  });

  it('surfaces a 409 when deleting a project that has entries', async () => {
    const user = userEvent.setup();
    removeMock.mockRejectedValue(
      Object.assign(new Error('Project has timesheet entries and cannot be deleted'), {
        status: 409,
      }),
    );
    render(<ProjectsPage />);

    await screen.findByText('ERP-001');
    await user.click(screen.getByRole('button', { name: /delete project erp-001/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /delete project/i }));

    expect(await screen.findByText(/has timesheet entries/i)).toBeInTheDocument();
    // The confirmation stays honest: the project row remains.
    expect(screen.getByText('ERP-001')).toBeInTheDocument();
  });
});
