import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { ProfilePage } from './profile-page';

const useAuth = vi.fn();
const employeeRepoGet = vi.fn();
const employeeRepoSelfUpdate = vi.fn();
const isRealBackend = vi.fn();

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => useAuth(),
}));

vi.mock('@/lib/api/repositories', () => ({
  employeeRepo: {
    get: (...args: unknown[]) => employeeRepoGet(...args),
    selfUpdate: (...args: unknown[]) => employeeRepoSelfUpdate(...args),
  },
}));

vi.mock('@/data/data-layer', () => ({
  isRealBackend: () => isRealBackend(),
}));

const mockEmployee = {
  id: 'emp-1',
  employeeNo: 'EMP-2026-0001',
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-01-15',
  gender: 'Female',
  nationalId: 'ID123456',
  email: 'jane@example.com',
  phone: '+1234567890',
  address: '123 Main St',
  emergencyContactName: 'John Doe',
  emergencyContactRelationship: 'Spouse',
  emergencyContactPhone: '+9876543210',
  departmentId: 'd-1',
  departmentName: 'Engineering',
  positionId: 'p-1',
  positionName: 'Developer',
  managerId: 'm-1',
  managerName: 'Boss',
  hireDate: '2024-01-01',
  employmentType: 'Full-time' as const,
  salary: 80000,
  status: 'Active' as const,
  avatarUrl: undefined,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

const mockUser = {
  id: 'u-1',
  email: 'jane@example.com',
  role: 'Employee',
  status: 'active' as const,
  employeeId: 'emp-1',
};

const updateEmployee = vi.fn();

function renderProfile(
  overrides: Record<string, unknown> = {},
  options: { realBackend?: boolean } = {},
) {
  isRealBackend.mockReturnValue(options.realBackend ?? false);
  useAuth.mockReturnValue({
    user: mockUser,
    employee: mockEmployee,
    updateEmployee,
    hasPermission: (cap: string) => cap === 'viewOwnProfile',
    ...overrides,
  });
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    employeeRepoGet.mockResolvedValue(mockEmployee);
  });

  it('renders employee department and position', () => {
    renderProfile();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('shows "No employee profile linked" when employee is null', () => {
    renderProfile({ employee: null });
    expect(screen.getByText('No employee profile linked')).toBeInTheDocument();
  });

  it('hides salary for non-authorized roles', () => {
    renderProfile({ hasPermission: () => false });
    expect(screen.queryByText('$80,000')).not.toBeInTheDocument();
  });

  it('shows salary for authorized roles', () => {
    renderProfile({ hasPermission: (cap: string) => cap === 'accessSalary' });
    expect(screen.getByText('$80,000')).toBeInTheDocument();
  });

  it('enters edit mode when Edit is clicked', () => {
    renderProfile();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByDisplayValue('+1234567890')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
  });

  it('cancel discards changes and returns to read-only', () => {
    renderProfile();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1234567890');
    fireEvent.change(phoneInput, { target: { value: '+9999999999' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('+1234567890')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('+9999999999')).not.toBeInTheDocument();
  });

  it('saves changes and calls updateEmployee in mock mode', async () => {
    renderProfile();
    fireEvent.click(screen.getByText('Edit'));
    const phoneInput = screen.getByDisplayValue('+1234567890');
    fireEvent.change(phoneInput, { target: { value: '+5555555555' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+5555555555' }),
      );
    });
  });

  it('shows success toast after save', async () => {
    renderProfile();
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText('Profile updated successfully.')).toBeInTheDocument();
    });
  });

  it('shows error toast when save fails', async () => {
    employeeRepoGet.mockResolvedValue(mockEmployee);
    employeeRepoSelfUpdate.mockRejectedValue(new Error('Network error'));
    isRealBackend.mockReturnValue(true);
    useAuth.mockReturnValue({
      user: { ...mockUser },
      employee: { ...mockEmployee },
      updateEmployee,
      hasPermission: () => false,
    });
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    // Error toast keeps edit mode open
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('shows generic error message when save rejects with non-Error', async () => {
    employeeRepoGet.mockResolvedValue(mockEmployee);
    employeeRepoSelfUpdate.mockRejectedValue('string failure');
    isRealBackend.mockReturnValue(true);
    useAuth.mockReturnValue({
      user: { ...mockUser },
      employee: { ...mockEmployee },
      updateEmployee,
      hasPermission: () => false,
    });
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Could not save changes. Please try again.')).toBeInTheDocument();
    });
  });

  describe('field validation', () => {
    function enterEdit() {
      fireEvent.click(screen.getByText('Edit'));
    }

    it('blocks save with too-short phone number', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('+1234567890'), {
        target: { value: '123' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(
        await screen.findByText('Phone number must contain at least 7 digits.'),
      ).toBeInTheDocument();
      expect(updateEmployee).not.toHaveBeenCalled();
      // Still in edit mode
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('blocks save when phone was previously set but is emptied', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('+1234567890'), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(await screen.findByText('Phone cannot be emptied.')).toBeInTheDocument();
      expect(updateEmployee).not.toHaveBeenCalled();
    });

    it('blocks save when address was previously set but is emptied', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('123 Main St'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(await screen.findByText('Address cannot be emptied.')).toBeInTheDocument();
      expect(updateEmployee).not.toHaveBeenCalled();
    });

    it('blocks save when emergency contact name was set but is emptied', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('John Doe'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(
        await screen.findByText('Emergency contact name cannot be emptied.'),
      ).toBeInTheDocument();
      expect(updateEmployee).not.toHaveBeenCalled();
    });

    it('blocks save when emergency contact phone was set but is emptied', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('+9876543210'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(
        await screen.findByText('Emergency contact phone cannot be emptied.'),
      ).toBeInTheDocument();
      expect(updateEmployee).not.toHaveBeenCalled();
    });

    it('blocks save when emergency contact phone is too short', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('+9876543210'), {
        target: { value: '12' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(
        await screen.findByText('Phone number must contain at least 7 digits.'),
      ).toBeInTheDocument();
      expect(updateEmployee).not.toHaveBeenCalled();
    });

    it('allows empty phone when none was previously set', async () => {
      useAuth.mockReturnValue({
        user: { ...mockUser },
        employee: { ...mockEmployee, phone: undefined },
        updateEmployee,
        hasPermission: () => false,
      });
      render(
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>,
      );
      enterEdit();
      // phone input starts empty; leave it empty and save
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => {
        expect(updateEmployee).toHaveBeenCalledWith(expect.objectContaining({ phone: '' }));
      });
    });

    it('trims whitespace before validating emptiness', async () => {
      renderProfile();
      enterEdit();
      fireEvent.change(screen.getByDisplayValue('+1234567890'), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(await screen.findByText('Phone cannot be emptied.')).toBeInTheDocument();
    });
  });

  describe('real backend mode', () => {
    it('calls employeeRepo.selfUpdate on save', async () => {
      employeeRepoGet.mockResolvedValue(mockEmployee);
      employeeRepoSelfUpdate.mockResolvedValue(undefined);
      renderProfile({}, { realBackend: true });
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(employeeRepoSelfUpdate).toHaveBeenCalledWith('emp-1', {
          phone: '+1234567890',
          address: '123 Main St',
          emergencyContactName: 'John Doe',
          emergencyContactRelationship: 'Spouse',
          emergencyContactPhone: '+9876543210',
        });
      });
    });

    it('refreshes employee data in background on mount', async () => {
      employeeRepoGet.mockResolvedValue({ ...mockEmployee, phone: '+0000000000' });
      renderProfile({}, { realBackend: true });
      await waitFor(() => {
        expect(employeeRepoGet).toHaveBeenCalledWith('emp-1');
      });
      expect(updateEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+0000000000' }),
      );
    });

    it('silently ignores background refresh failure', async () => {
      employeeRepoGet.mockRejectedValue(new Error('boom'));
      renderProfile({}, { realBackend: true });
      // No throw; component still renders read-only fields
      await waitFor(() => {
        expect(employeeRepoGet).toHaveBeenCalledWith('emp-1');
      });
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });
  });

  describe('background refresh guards', () => {
    it('does not call get when not a real backend', () => {
      isRealBackend.mockReturnValue(false);
      renderProfile();
      expect(employeeRepoGet).not.toHaveBeenCalled();
    });

    it('does not call get when user has no employeeId', () => {
      isRealBackend.mockReturnValue(true);
      useAuth.mockReturnValue({
        user: { ...mockUser, employeeId: undefined },
        employee: mockEmployee,
        updateEmployee,
        hasPermission: () => false,
      });
      render(
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>,
      );
      expect(employeeRepoGet).not.toHaveBeenCalled();
    });
  });

  describe('emergency contact access control', () => {
    it('hides emergency contact details without accessSalary', () => {
      renderProfile({ hasPermission: () => false });
      expect(
        screen.getByText('Emergency contact details are restricted. Contact HR for updates.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });

    it('shows emergency contact details with accessSalary', () => {
      renderProfile({ hasPermission: (cap: string) => cap === 'accessSalary' });
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Spouse')).toBeInTheDocument();
      expect(screen.getByText('+9876543210')).toBeInTheDocument();
    });

    it('masks national ID without accessSalary', () => {
      renderProfile({ hasPermission: () => false });
      expect(screen.getByText('••••••••')).toBeInTheDocument();
      expect(screen.queryByText('ID123456')).not.toBeInTheDocument();
    });

    it('reveals national ID with accessSalary', () => {
      renderProfile({ hasPermission: (cap: string) => cap === 'accessSalary' });
      expect(screen.getByText('ID123456')).toBeInTheDocument();
    });
  });

  describe('status badge', () => {
    it('renders Active badge in green', () => {
      renderProfile({ employee: { ...mockEmployee, status: 'Active' } });
      const badge = screen.getByText('Active');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toContain('bg-green-100');
    });

    it('renders On Leave badge in yellow', () => {
      renderProfile({ employee: { ...mockEmployee, status: 'On Leave' } });
      const badge = screen.getByText('On Leave');
      expect(badge.className).toContain('bg-yellow-100');
    });

    it('renders other status badge in gray', () => {
      renderProfile({ employee: { ...mockEmployee, status: 'Terminated' } });
      const badge = screen.getByText('Terminated');
      expect(badge.className).toContain('bg-gray-100');
    });
  });

  describe('salary rendering', () => {
    it('renders em dash when salary is null and accessible', () => {
      renderProfile({
        employee: { ...mockEmployee, salary: null, status: 'Active' },
        hasPermission: (cap: string) => cap === 'accessSalary',
      });
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('date formatting', () => {
    it('formats date of birth', () => {
      renderProfile();
      expect(screen.getByText('Jan 15, 1990')).toBeInTheDocument();
    });

    it('shows em dash for missing date of birth', () => {
      renderProfile({ employee: { ...mockEmployee, dateOfBirth: '' } });
      // The "—" appears for the empty DOB field row
      const dobRow = screen.getByText('Date of Birth').closest('div')?.parentElement;
      expect(dobRow).toHaveTextContent('—');
    });
  });

  describe('toast auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('dismisses the success toast after 4 seconds', async () => {
      renderProfile();
      fireEvent.click(screen.getByText('Edit'));
      await act(async () => {
        fireEvent.click(screen.getByText('Save'));
      });

      expect(screen.getByText('Profile updated successfully.')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText('Profile updated successfully.')).not.toBeInTheDocument();
    });
  });

  describe('saving button state', () => {
    it('disables Save and Cancel while saving in real backend mode', async () => {
      employeeRepoGet.mockResolvedValue(mockEmployee);
      employeeRepoSelfUpdate.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 50)),
      );
      renderProfile({}, { realBackend: true });
      fireEvent.click(screen.getByText('Edit'));
      fireEvent.click(screen.getByText('Save'));
      // During the await, saving is true
      expect(screen.getByText('Saving...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled();

      await waitFor(() => {
        expect(employeeRepoSelfUpdate).toHaveBeenCalled();
      });
    });
  });

  describe('edit mode guards', () => {
    it('does not enter edit mode when no employee is linked', () => {
      useAuth.mockReturnValue({
        user: mockUser,
        employee: null,
        updateEmployee,
        hasPermission: () => false,
      });
      render(
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>,
      );
      // No Edit button because the no-profile branch renders before the header
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    });
  });
});
