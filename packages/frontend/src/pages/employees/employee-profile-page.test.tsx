import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const paramsState = vi.hoisted(() => ({ id: 'e1' as string | undefined }));
const listChangesMock = vi.fn();
const recordChangeMock = vi.fn();
const uploadDocumentMock = vi.hoisted(() => vi.fn());
const downloadDocumentMock = vi.hoisted(() => vi.fn());
const profileState = vi.hoisted(() => ({
  employees: [] as unknown[],
  documents: [] as unknown[],
}));

vi.mock('react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useParams: () => paramsState,
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
    value?: string;
  }) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children ??
        (options ?? []).map((o: { value: string; label: string }) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: profileState.employees, mode: 'live', error: null }),
  useDocuments: () => ({
    data: profileState.documents,
    mode: 'live',
    error: null,
    upload: (...args: unknown[]) => uploadDocumentMock(...args),
    download: (...args: unknown[]) => downloadDocumentMock(...args),
  }),
}));

vi.mock('@/lib/api/repositories', () => ({
  employeeRepo: {
    listChanges: (...args: unknown[]) => listChangesMock(...args),
    recordChange: (...args: unknown[]) => recordChangeMock(...args),
  },
}));

import { EmployeeProfilePage } from './employee-profile-page';

const employee = {
  id: 'e1',
  firstName: 'Alice',
  lastName: 'Admin',
  email: 'alice@acme.com',
  phone: '+1 415 555 0100',
  address: '123 Market St, San Francisco',
  employeeNo: 'E001',
  departmentId: 'd1',
  departmentName: 'Human Resources',
  positionId: 'p1',
  positionName: 'HR Lead',
  managerId: 'm1',
  managerName: 'Big Boss',
  hireDate: '2022-01-01T00:00:00.000Z',
  employmentType: 'Full-time',
  status: 'Active' as const,
  salary: 90000,
  nationalId: 'ID-123456',
  dateOfBirth: '1990-01-01T00:00:00.000Z',
  gender: 'Female',
  emergencyContactName: 'John',
  emergencyContactRelationship: 'Spouse',
  emergencyContactPhone: '+1 415 555 0200',
  createdAt: '2022-01-01T00:00:00.000Z',
  updatedAt: '2023-01-01T00:00:00.000Z',
};

const documents = [
  {
    id: 'doc1',
    employeeId: 'e1',
    type: 'Passport' as const,
    originalFilename: 'passport.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    uploadedBy: 'alice@acme.com',
    uploadedAt: '2023-01-01T00:00:00.000Z',
    expiryDate: '2030-01-01T00:00:00.000Z',
  },
];

const makeAuth = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'Admin', email: 'admin@acme.com', employeeId: 'e1' },
  hasPermission: vi.fn(() => true),
  canViewEmployee: vi.fn(() => true),
  ...overrides,
});

beforeEach(() => {
  paramsState.id = 'e1';
  profileState.employees = [employee];
  profileState.documents = documents;
  listChangesMock.mockResolvedValue([]);
  recordChangeMock.mockResolvedValue({});
  uploadDocumentMock.mockResolvedValue({});
  downloadDocumentMock.mockResolvedValue(new Blob());
  useAuthMock.mockReturnValue(makeAuth());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmployeeProfilePage', () => {
  it('renders the employee name and overview details', () => {
    render(<EmployeeProfilePage />);
    expect(screen.getByRole('heading', { name: 'Alice Admin' })).toBeInTheDocument();
    expect(screen.getByText('Human Resources')).toBeInTheDocument();
    expect(screen.getByText('HR Lead')).toBeInTheDocument();
    expect(screen.getByText('alice@acme.com')).toBeInTheDocument();
  });

  it('shows the edit profile button for HR/Admin', () => {
    render(<EmployeeProfilePage />);
    const editLink = screen.getByRole('link', { name: /edit profile/i });
    expect(editLink).toHaveAttribute('href', '/app/employees/e1/edit');
  });

  it('reveals sensitive national ID and salary for users with salary access', () => {
    render(<EmployeeProfilePage />);
    expect(screen.getByText('ID-123456')).toBeInTheDocument();
    expect(screen.getByText('$90,000')).toBeInTheDocument();
  });

  it('masks the national ID and hides salary for users without salary access', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u2', role: 'Employee', email: 'bob@acme.com', employeeId: 'e2' },
        hasPermission: vi.fn((p: string) => p !== 'accessSalary'),
      }),
    );
    render(<EmployeeProfilePage />);
    expect(screen.queryByText('ID-123456')).not.toBeInTheDocument();
    expect(screen.getByText(/restricted/i)).toBeInTheDocument();
    expect(screen.queryByText('$90,000')).not.toBeInTheDocument();
  });

  it('shows an access-restricted state when canViewEmployee returns false', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u2', role: 'Employee', email: 'bob@acme.com', employeeId: 'e2' },
        canViewEmployee: vi.fn(() => false),
      }),
    );
    render(<EmployeeProfilePage />);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
  });

  it('shows a "not found" state when the employee does not exist', () => {
    profileState.employees = [];
    render(<EmployeeProfilePage />);
    expect(screen.getByText(/employee not found/i)).toBeInTheDocument();
  });

  it('lists the employee documents in the Documents tab', async () => {
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(await screen.findByText('passport.pdf')).toBeInTheDocument();
    expect(screen.getByText('Passport')).toBeInTheDocument();
  });

  it('shows the change history tab as empty when there are no changes', async () => {
    listChangesMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    expect(await screen.findByText(/no changes recorded/i)).toBeInTheDocument();
  });

  it('renders recorded employment changes', async () => {
    listChangesMock.mockResolvedValue([
      {
        id: 'c1',
        changeType: 'Promotion',
        oldValue: 'Junior',
        newValue: 'Senior',
        reason: 'Strong performance',
        effectiveDate: '2024-01-01',
        recordedBy: 'admin@acme.com',
        recordedAt: '2024-01-01T00:00:00.000Z',
        status: 'Applied',
      },
    ]);
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    expect(await screen.findByText('Promotion')).toBeInTheDocument();
    expect(screen.getByText('Strong performance')).toBeInTheDocument();
  });

  it('allows HR/Admin to upload a document via the dialog', async () => {
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    await user.click(await screen.findByRole('button', { name: /upload/i }));
    // The dialog title and its submit button both read "Upload document".
    expect(await screen.findAllByText('Upload document')).toHaveLength(2);
  });

  it('allows HR/Admin to record an employment change via the dialog', async () => {
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    await user.click(await screen.findByRole('button', { name: /record change/i }));
    expect(await screen.findByText('Record employment change')).toBeInTheDocument();
  });

  it('hides the upload and record-change actions for non-HR/non-manager viewers', async () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u2', role: 'Employee', email: 'bob@acme.com', employeeId: 'e2' },
        hasPermission: vi.fn((p: string) => p !== 'viewAllEmployees' && p !== 'accessSalary'),
      }),
    );
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    expect(screen.queryByRole('button', { name: /record change/i })).not.toBeInTheDocument();
  });

  it('submits a recorded employment change from the dialog', async () => {
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    await user.click(await screen.findByRole('button', { name: /record change/i }));
    expect(await screen.findByText('Record employment change')).toBeInTheDocument();
    // Fill the form fields.
    fireEvent.change(screen.getByPlaceholderText(/junior engineer/i), {
      target: { value: 'Junior' },
    });
    fireEvent.change(screen.getByPlaceholderText(/senior engineer/i), {
      target: { value: 'Senior' },
    });
    fireEvent.change(screen.getByPlaceholderText(/brief reason for this change/i), {
      target: { value: 'Strong performance' },
    });
    await user.click(screen.getByRole('button', { name: /^record change$/i }));
    expect(
      await waitFor(() =>
        expect(recordChangeMock).toHaveBeenCalledWith(
          'e1',
          expect.objectContaining({ oldValue: 'Junior', newValue: 'Senior' }),
        ),
      ),
    );
  });

  it('fills change type, effective date and submits the employment change', async () => {
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    await user.click(await screen.findByRole('button', { name: /record change/i }));
    expect(await screen.findByText('Record employment change')).toBeInTheDocument();

    // Change-type is rendered via the mocked Select component inside the dialog.
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByTestId('select'), { target: { value: 'Manager Change' } });
    fireEvent.change(screen.getByPlaceholderText(/junior engineer/i), {
      target: { value: 'Old Manager' },
    });
    fireEvent.change(screen.getByPlaceholderText(/senior engineer/i), {
      target: { value: 'New Manager' },
    });
    fireEvent.change(screen.getByPlaceholderText(/brief reason for this change/i), {
      target: { value: 'Reorg' },
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-03-01' } });

    await user.click(screen.getByRole('button', { name: /^record change$/i }));
    expect(
      await waitFor(() =>
        expect(recordChangeMock).toHaveBeenCalledWith(
          'e1',
          expect.objectContaining({
            changeType: 'Manager Change',
            oldValue: 'Old Manager',
            newValue: 'New Manager',
            reason: 'Reorg',
            effectiveDate: '2026-03-01',
          }),
        ),
      ),
    );
  });

  it('surfaces an error and keeps the dialog open when recording a change rejects', async () => {
    const user = userEvent.setup();
    recordChangeMock.mockRejectedValueOnce(new Error('boom'));
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    await user.click(await screen.findByRole('button', { name: /record change/i }));
    expect(await screen.findByText('Record employment change')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/junior engineer/i), {
      target: { value: 'Junior' },
    });
    fireEvent.change(screen.getByPlaceholderText(/senior engineer/i), {
      target: { value: 'Senior' },
    });
    await user.click(screen.getByRole('button', { name: /^record change$/i }));
    await waitFor(() => expect(recordChangeMock).toHaveBeenCalled());
    // The dialog remains open so the user can retry.
    expect(screen.getByText('Record employment change')).toBeInTheDocument();
  });

  it('hides the edit profile link for a manager-scoped viewer of another employee', () => {
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u-mgr', role: 'Manager', email: 'mgr@acme.com', employeeId: 'e-other' },
        hasPermission: vi.fn((p: string) => p !== 'viewAllEmployees'),
      }),
    );
    render(<EmployeeProfilePage />);
    expect(screen.queryByRole('link', { name: /edit profile/i })).not.toBeInTheDocument();
  });

  it('renders the deactivation date for a deactivated employee', () => {
    profileState.employees = [
      { ...employee, status: 'Deactivated' as const, deactivationDate: '2026-01-15' },
    ];
    render(<EmployeeProfilePage />);
    expect(screen.getByText(/deactivation date/i)).toBeInTheDocument();
    expect(screen.getByText('Jan 15, 2026')).toBeInTheDocument();
  });

  it('allows the employee manager to view the overview without restriction', () => {
    // The employee's managerId is 'm1'; a manager whose employeeId matches that is the manager.
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u-mgr', role: 'Manager', email: 'mgr@acme.com', employeeId: 'm1' },
        hasPermission: vi.fn((p: string) => p !== 'viewAllEmployees'),
      }),
    );
    render(<EmployeeProfilePage />);
    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
  });
});

describe('document list and expiry states', () => {
  // Pin the clock so expiry fixtures stay deterministic regardless of when CI runs.
  // Only Date is faked; real timers keep findByText/userEvent working normally.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-07T12:00:00.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  const makeDoc = (overrides: Record<string, unknown> = {}) => ({
    id: 'doc-1',
    employeeId: 'e1',
    type: 'Passport' as const,
    originalFilename: 'passport.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    uploadedBy: 'alice@acme.com',
    uploadedAt: '2023-01-01T00:00:00.000Z',
    expiryDate: null,
    ...overrides,
  });

  it('shows a dash when a document has no expiry date', async () => {
    profileState.documents = [makeDoc()];
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('flags a document that has already expired', async () => {
    profileState.documents = [makeDoc({ expiryDate: '2025-12-31T00:00:00.000Z' })];
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it('flags a document expiring within 30 days', async () => {
    // The clock is pinned to 2026-08-07; a date 13 days out is within the 30-day window.
    const inThirteenDays = new Date(Date.now() + 13 * 86400000).toISOString();
    profileState.documents = [makeDoc({ expiryDate: inThirteenDays })];
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(await screen.findByText(/·\s*\d+d/)).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  it('renders a normal future expiry date without a warning', async () => {
    profileState.documents = [makeDoc({ expiryDate: '2026-12-31T00:00:00.000Z' })];
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(await screen.findByText('Dec 31, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no documents', async () => {
    profileState.documents = [];
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(
      await screen.findByText(/no documents have been uploaded for this employee yet/i),
    ).toBeInTheDocument();
  });

  it('renders a download button for each document', async () => {
    profileState.documents = [makeDoc()];
    const user = userEvent.setup();
    const { container } = render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    await screen.findByText('passport.pdf');
    expect(container.querySelector('button[title="Download"]')).toBeTruthy();
  });
});

describe('upload button gating', () => {
  it('hides the upload button for a non-HR/Admin viewer', async () => {
    // A viewer without the 'viewAllEmployees' permission must not see the upload action.
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u-emp', role: 'Employee', email: 'emp@acme.com', employeeId: 'e1' },
        hasPermission: vi.fn((p: string) => p !== 'viewAllEmployees'),
      }),
    );
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /documents/i }));
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
  });
});

describe('record change dialog cancel', () => {
  it('closes without recording when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    await user.click(await screen.findByRole('button', { name: /record change/i }));
    expect(await screen.findByText('Record employment change')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(recordChangeMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Record employment change')).not.toBeInTheDocument();
  });
});

describe('employment change list failure', () => {
  it('falls back to an empty history when listChanges rejects', async () => {
    listChangesMock.mockRejectedValueOnce(new Error('network error'));
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    expect(await screen.findByText(/no changes recorded/i)).toBeInTheDocument();
  });
});

describe('manager recording a change', () => {
  it('records a change with Pending status when submitted by the employee manager', async () => {
    // isManagerOfEmployee => managerId ('m1') equals auth.employeeId.
    useAuthMock.mockReturnValue(
      makeAuth({
        user: { id: 'u-mgr', role: 'Manager', email: 'mgr@acme.com', employeeId: 'm1' },
        hasPermission: vi.fn((p: string) => p !== 'viewAllEmployees'),
      }),
    );
    const user = userEvent.setup();
    render(<EmployeeProfilePage />);
    await user.click(screen.getByRole('tab', { name: /change history/i }));
    await user.click(await screen.findByRole('button', { name: /record change/i }));
    expect(await screen.findByText('Record employment change')).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByTestId('select'), { target: { value: 'Manager Change' } });
    fireEvent.change(screen.getByPlaceholderText(/junior engineer/i), {
      target: { value: 'Old Manager' },
    });
    fireEvent.change(screen.getByPlaceholderText(/senior engineer/i), {
      target: { value: 'New Manager' },
    });
    fireEvent.change(screen.getByPlaceholderText(/brief reason for this change/i), {
      target: { value: 'Reorg' },
    });

    await user.click(screen.getByRole('button', { name: /^record change$/i }));
    expect(
      await waitFor(() =>
        expect(recordChangeMock).toHaveBeenCalledWith(
          'e1',
          expect.objectContaining({
            changeType: 'Manager Change',
            oldValue: 'Old Manager',
            newValue: 'New Manager',
            reason: 'Reorg',
          }),
        ),
      ),
    );
  });
});
