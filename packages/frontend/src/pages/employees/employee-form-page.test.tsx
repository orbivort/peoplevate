import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
void userEvent;

// Hoisted mutable mocks
const useAuthMock = vi.fn();
const navigateMock = vi.fn();
const paramsState = vi.hoisted(() => ({ id: undefined as string | undefined }));
const createEmployeeMock = vi.fn();
const updateEmployeeMock = vi.fn();
const formState = vi.hoisted(() => ({
  employees: [] as Record<string, unknown>[],
  departments: [] as Record<string, unknown>[],
  positions: [] as Record<string, unknown>[],
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
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
  useNavigate: () => navigateMock,
  useParams: () => paramsState,
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
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock('@/data/data-layer', () => ({
  useEmployees: () => ({ data: formState.employees, mode: 'live', error: null }),
  useDepartments: () => ({ data: formState.departments, mode: 'live', error: null }),
  usePositions: () => ({ data: formState.positions, mode: 'live', error: null }),
  createEmployee: (...args: unknown[]) => createEmployeeMock(...args),
  updateEmployee: (...args: unknown[]) => updateEmployeeMock(...args),
}));

import { EmployeeFormPage } from './employee-form-page';

// Field renders a <Label> sibling to the control inside the same wrapper div,
// without an htmlFor/id association, so we resolve the control via its label.
function controlFor(labelText: string): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea') as HTMLElement;
  if (!control) throw new Error(`No control found for label "${labelText}"`);
  return control;
}

// Controlled inputs update reliably via fireEvent.change.
function setControl(labelText: string, value: string) {
  fireEvent.change(controlFor(labelText), { target: { value } });
}

const departments = [
  { id: 'd1', name: 'Human Resources' },
  { id: 'd2', name: 'Engineering' },
];
const positions = [
  { id: 'p1', name: 'HR Lead', departmentId: 'd1' },
  { id: 'p2', name: 'Software Engineer', departmentId: 'd2' },
];
const employees = [
  {
    id: 'e1',
    firstName: 'Alice',
    lastName: 'Admin',
    email: 'alice@example.com',
    employeeNo: 'E001',
    departmentId: 'd1',
    departmentName: 'Human Resources',
    positionId: 'p1',
    positionName: 'HR Lead',
    managerId: null,
    hireDate: '2022-01-01',
    employmentType: 'Full-time',
    status: 'Active' as const,
    salary: 90000,
    nationalId: 'ID-111',
    dateOfBirth: '1990-01-01',
    gender: 'Female',
    phone: '+1 123 555 0100',
    address: '1 Invented St, Springfield',
    emergencyContactName: 'John',
    emergencyContactRelationship: 'Spouse',
    emergencyContactPhone: '+1 123 555 0200',
  },
];

const makeAuth = (canAccessSensitive = true) => ({
  hasPermission: vi.fn((p: string) => (p === 'accessSalary' ? canAccessSensitive : true)),
});

beforeEach(() => {
  paramsState.id = undefined;
  formState.employees = employees;
  formState.departments = departments;
  formState.positions = positions;
  navigateMock.mockReset();
  useAuthMock.mockReturnValue(makeAuth(true));
  createEmployeeMock.mockImplementation((payload: Record<string, unknown>) => ({
    id: 'e-new',
    ...payload,
  }));
  updateEmployeeMock.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmployeeFormPage', () => {
  it('renders the "New employee" form with all sections', () => {
    render(<EmployeeFormPage />);
    expect(screen.getByRole('heading', { name: /new employee/i })).toBeInTheDocument();
    expect(controlFor('First name')).toBeInTheDocument();
    expect(controlFor('Email')).toBeInTheDocument();
    expect(screen.getByText('Personal information')).toBeInTheDocument();
    expect(screen.getByText('Employment details')).toBeInTheDocument();
  });

  it('shows validation errors when required fields are missing on submit', async () => {
    render(<EmployeeFormPage />);
    // The create form starts blank, so submitting without filling required
    // fields surfaces validation errors for every missing required field.
    fireEvent.submit(document.getElementById('employee-form') as HTMLElement);
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/hire date is required/i)).toBeInTheDocument();
    expect(screen.getByText(/employment type is required/i)).toBeInTheDocument();
    expect(createEmployeeMock).not.toHaveBeenCalled();
  });

  it('disables sensitive fields when the user lacks salary access', () => {
    useAuthMock.mockReturnValue(makeAuth(false));
    render(<EmployeeFormPage />);
    expect(controlFor('National ID')).toBeDisabled();
  });

  it('creates an employee and navigates to the new profile', async () => {
    render(<EmployeeFormPage />);
    setControl('First name', 'New');
    setControl('Last name', 'Hire');
    setControl('Email', 'new.hire@example.com');
    setControl('Hire date', '2024-06-01');
    fireEvent.change(controlFor('Department'), { target: { value: 'd1' } });
    fireEvent.change(controlFor('Position'), { target: { value: 'p1' } });
    fireEvent.change(controlFor('Employment type'), { target: { value: 'Full-time' } });
    fireEvent.submit(document.getElementById('employee-form') as HTMLElement);

    await waitFor(() => expect(createEmployeeMock).toHaveBeenCalled());
    const call = createEmployeeMock.mock.calls[0][0];
    expect(call.firstName).toBe('New');
    expect(call.email).toBe('new.hire@example.com');
    expect(navigateMock).toHaveBeenCalledWith('/app/employees/e-new', { replace: true });
  });

  it('prefills the form in edit mode and submits an update', async () => {
    paramsState.id = 'e1';
    render(<EmployeeFormPage />);
    expect(await screen.findByRole('heading', { name: /edit employee/i })).toBeInTheDocument();
    const firstName = controlFor('First name') as HTMLInputElement;
    expect(firstName.value).toBe('Alice');
    setControl('First name', 'Alicia');
    fireEvent.submit(document.getElementById('employee-form') as HTMLElement);

    await waitFor(() =>
      expect(updateEmployeeMock).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({
          firstName: 'Alicia',
        }),
      ),
    );
    expect(navigateMock).toHaveBeenCalledWith('/app/employees/e1', { replace: true });
  });

  it('shows a submit error when the create request fails', async () => {
    createEmployeeMock.mockRejectedValue(new Error('Email already exists.'));
    render(<EmployeeFormPage />);
    setControl('First name', 'New');
    setControl('Last name', 'Hire');
    setControl('Email', 'new.hire@example.com');
    setControl('Hire date', '2024-06-01');
    fireEvent.change(controlFor('Department'), { target: { value: 'd1' } });
    fireEvent.change(controlFor('Position'), { target: { value: 'p1' } });
    fireEvent.change(controlFor('Employment type'), { target: { value: 'Full-time' } });
    fireEvent.submit(document.getElementById('employee-form') as HTMLElement);

    expect(await screen.findByText(/email already exists/i)).toBeInTheDocument();
  });
});
