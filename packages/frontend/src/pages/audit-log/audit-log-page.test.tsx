import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const hasPermissionMock = vi.fn(() => true);
const reloadMock = vi.fn();
const auditLogState = vi.hoisted(() => ({
  data: { logs: [] as unknown[], total: 0 },
  loading: false,
  error: null as string | null,
  mode: 'mock' as const,
}));
const useAuditLogMock = vi.fn(() => ({
  ...auditLogState,
  reload: reloadMock,
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (v: string) => void;
    value: string;
  }) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder: string }) => (
    <option value="">{placeholder}</option>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// The Pagination component uses Button which renders real buttons; we keep it
// real so navigation interactions can be asserted.
vi.mock('@/data/data-layer', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuditLog: (params: unknown) => {
      useAuditLogMock(params);
      return { ...auditLogState, reload: reloadMock };
    },
  };
});

import { AuditLogPage } from './audit-log-page';

const sampleEntries = [
  {
    id: 'a1',
    actorId: 'u1',
    actorName: 'Alice Admin',
    action: 'CREATE',
    entity: 'employees',
    entityLabel: 'Employees',
    entityId: 'e1',
    changes: [{ field: 'name', label: 'name', old: null, new: 'Bob', sensitive: false }],
    status: 'Success',
    timestamp: '2026-01-15T10:00:00.000Z',
  },
  {
    id: 'a2',
    actorId: 'u2',
    actorName: 'Bob Manager',
    action: 'UPDATE',
    entity: 'departments',
    entityLabel: 'Departments',
    entityId: 'd1',
    changes: [
      { field: 'name', label: 'name', old: 'Old', new: 'New', sensitive: false },
      { field: 'email', label: 'email', old: '[redacted]', new: '[redacted]', sensitive: true },
    ],
    status: 'Success',
    timestamp: '2026-02-20T12:30:00.000Z',
  },
];

function setAuditLog(logs: unknown[], total: number) {
  auditLogState.data = { logs, total };
  auditLogState.loading = false;
  auditLogState.error = null;
}

/** Generate `count` sample entries so the page spans multiple pages. */
function manyEntries(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `log-${i}`,
    actorId: 'u1',
    actorName: `Actor ${i}`,
    action: 'CREATE',
    entity: 'employees',
    entityLabel: 'Employees',
    entityId: `e-${i}`,
    changes: [{ field: 'name', label: 'name', old: null, new: `Item ${i}`, sensitive: false }],
    status: 'Success',
    timestamp: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  }));
}

/** Find the entity filter <select> (the one containing the "employees" option). */
function entitySelect(): HTMLSelectElement {
  const selects = screen.getAllByTestId('select') as HTMLSelectElement[];
  const entity = selects.find((s) => Array.from(s.options).some((o) => o.value === 'employees'));
  if (!entity) throw new Error('Entity filter select not found');
  return entity;
}

/** Find the page-size <select> (the one containing the "50" option). */
function pageSizeSelect(): HTMLSelectElement {
  const selects = screen.getAllByTestId('select') as HTMLSelectElement[];
  const size = selects.find((s) => Array.from(s.options).some((o) => o.value === '50'));
  if (!size) throw new Error('Page size select not found');
  return size;
}

beforeEach(() => {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', role: 'admin', name: 'Alice Admin' },
    employee: { id: 'e1', firstName: 'Alice', lastName: 'Admin' },
    hasPermission: hasPermissionMock,
    canViewEmployee: vi.fn(() => true),
  });
  hasPermissionMock.mockReturnValue(true);
  setAuditLog([], 0);
  auditLogState.mode = 'mock';
  useAuditLogMock.mockClear();
  reloadMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuditLogPage', () => {
  it('renders the audit log heading', () => {
    render(<AuditLogPage />);
    expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument();
  });

  it('renders audit entries with actor, action and entity', async () => {
    setAuditLog(sampleEntries, 2);
    render(<AuditLogPage />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Manager')).toBeInTheDocument();
    expect(screen.getByText('CREATE')).toBeInTheDocument();
    expect(screen.getByText('UPDATE')).toBeInTheDocument();
    // "Employees" appears both as a table cell and an entity filter option.
    expect(screen.getAllByText('Employees').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Departments').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the total entry count', async () => {
    setAuditLog(sampleEntries, 2);
    render(<AuditLogPage />);
    expect(await screen.findByText('2 entries')).toBeInTheDocument();
  });

  it('renders an empty state when there are no entries', async () => {
    setAuditLog([], 0);
    render(<AuditLogPage />);
    expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument();
    expect(screen.getByText(/no entries match your current filters/i)).toBeInTheDocument();
  });

  it('passes the search query to the backend', async () => {
    setAuditLog(sampleEntries, 2);
    const user = userEvent.setup();
    render(<AuditLogPage />);
    const search = screen.getByPlaceholderText(/search entity, values/i);
    await user.type(search, 'Department');
    // The page resets to page 1 and the next fetch includes the search query.
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as {
        search?: string;
        page: number;
      };
      expect(lastCall.search).toBe('Department');
      expect(lastCall.page).toBe(1);
    });
  });

  it('resets to page 1 when filters change', async () => {
    // 30 entries with default page size 25 yields 2 pages.
    setAuditLog(manyEntries(30), 30);
    const user = userEvent.setup();
    render(<AuditLogPage />);
    // Navigate to the next page.
    await user.click(await screen.findByLabelText('Next page'));
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as { page: number };
      expect(lastCall.page).toBe(2);
    });
    // Change the entity filter -> page resets to 1.
    await user.selectOptions(entitySelect(), 'departments');
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as {
        page: number;
        entity: string;
      };
      expect(lastCall.page).toBe(1);
      expect(lastCall.entity).toBe('departments');
    });
  });

  it('resets to page 1 when the page size changes', async () => {
    // 30 entries with default page size 25 yields 2 pages.
    setAuditLog(manyEntries(30), 30);
    const user = userEvent.setup();
    render(<AuditLogPage />);
    await user.click(await screen.findByLabelText('Next page'));
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as { page: number };
      expect(lastCall.page).toBe(2);
    });
    // Change the page size select -> page resets to 1.
    await user.selectOptions(pageSizeSelect(), '50');
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as {
        page: number;
        pageSize: number;
      };
      expect(lastCall.page).toBe(1);
      expect(lastCall.pageSize).toBe(50);
    });
  });

  it('shows skeleton rows while loading', async () => {
    auditLogState.data = { logs: [], total: 0 };
    auditLogState.loading = true;
    render(<AuditLogPage />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('passes hrScoped=false for users with full audit permission', async () => {
    hasPermissionMock.mockReturnValue(true);
    setAuditLog(sampleEntries, 2);
    render(<AuditLogPage />);
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as { hrScoped: boolean };
      expect(lastCall.hrScoped).toBe(false);
    });
  });

  it('passes hrScoped=true for HR-scoped users', async () => {
    hasPermissionMock.mockReturnValue(false);
    setAuditLog(sampleEntries, 2);
    render(<AuditLogPage />);
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as { hrScoped: boolean };
      expect(lastCall.hrScoped).toBe(true);
    });
  });

  it('renders the status column for each entry', async () => {
    setAuditLog(sampleEntries, 2);
    render(<AuditLogPage />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    // Status badge rendered for every entry.
    expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(2);
  });

  it('renders an error state when the fetch fails', async () => {
    auditLogState.data = { logs: [], total: 0 };
    auditLogState.loading = false;
    auditLogState.error = 'Backend unreachable';
    render(<AuditLogPage />);
    expect(await screen.findByText(/unable to load audit log/i)).toBeInTheDocument();
    expect(screen.getByText('Backend unreachable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('passes the user filter to the backend', async () => {
    setAuditLog(sampleEntries, 2);
    const user = userEvent.setup();
    render(<AuditLogPage />);
    const input = screen.getByPlaceholderText(/filter by user/i);
    await user.type(input, 'jing');
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as {
        user?: string;
        page: number;
      };
      expect(lastCall.user).toBe('jing');
      expect(lastCall.page).toBe(1);
    });
  });

  it('passes the date range to the backend', async () => {
    setAuditLog(sampleEntries, 2);
    const user = userEvent.setup();
    render(<AuditLogPage />);
    await user.type(screen.getByLabelText('From date'), '2026-01-01');
    await user.type(screen.getByLabelText('To date'), '2026-01-31');
    await waitFor(() => {
      const lastCall = useAuditLogMock.mock.calls.at(-1)?.[0] as {
        from?: string;
        to?: string;
        page: number;
      };
      expect(lastCall.from).toBe('2026-01-01');
      expect(lastCall.to).toBe('2026-01-31');
      expect(lastCall.page).toBe(1);
    });
  });

  it('triggers a reload when the refresh button is clicked', async () => {
    setAuditLog(sampleEntries, 2);
    const user = userEvent.setup();
    render(<AuditLogPage />);
    await user.click(await screen.findByRole('button', { name: /refresh audit log/i }));
    expect(reloadMock).toHaveBeenCalled();
  });
});
