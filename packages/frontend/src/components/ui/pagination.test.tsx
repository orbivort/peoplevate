import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Radix Select is mocked so the test can drive page-size changes via a native
// <select>, matching how the audit-log page test treats the Select primitive.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
    disabled,
  }: {
    children: React.ReactNode;
    onValueChange: (v: string) => void;
    value: string;
    disabled?: boolean;
  }) => (
    <select
      data-testid="pagination-page-size"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
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

import { Pagination } from './pagination';

describe('Pagination', () => {
  const baseProps = {
    page: 2,
    totalPages: 5,
    total: 125,
    pageSize: 25,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it('renders the result summary', () => {
    render(<Pagination {...baseProps} />);
    expect(screen.getByText(/showing/i)).toBeInTheDocument();
    expect(screen.getByText('26–50')).toBeInTheDocument();
    expect(screen.getByText('125')).toBeInTheDocument();
  });

  it('renders page numbers and marks the current page', () => {
    render(<Pagination {...baseProps} />);
    const current = screen.getByLabelText('Page 2');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 5')).toBeInTheDocument();
  });

  it('navigates with previous, next, first and last shortcuts', async () => {
    const user = userEvent.setup();
    render(<Pagination {...baseProps} />);

    await user.click(screen.getByLabelText('Next page'));
    expect(baseProps.onPageChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByLabelText('Previous page'));
    expect(baseProps.onPageChange).toHaveBeenCalledWith(1);

    await user.click(screen.getByLabelText('First page'));
    expect(baseProps.onPageChange).toHaveBeenCalledWith(1);

    await user.click(screen.getByLabelText('Last page'));
    expect(baseProps.onPageChange).toHaveBeenCalledWith(5);
  });

  it('disables navigation at the first page boundary', () => {
    render(<Pagination {...baseProps} page={1} />);
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('First page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).not.toBeDisabled();
  });

  it('disables navigation at the last page boundary', () => {
    render(<Pagination {...baseProps} page={5} />);
    expect(screen.getByLabelText('Next page')).toBeDisabled();
    expect(screen.getByLabelText('Last page')).toBeDisabled();
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled();
  });

  it('disables all controls while loading', () => {
    render(<Pagination {...baseProps} disabled />);
    expect(screen.getByLabelText('First page')).toBeDisabled();
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).toBeDisabled();
    expect(screen.getByLabelText('Last page')).toBeDisabled();
    expect(screen.getByTestId('pagination-page-size')).toBeDisabled();
  });

  it('calls onPageSizeChange when the page size changes', async () => {
    const user = userEvent.setup();
    render(<Pagination {...baseProps} />);
    await user.selectOptions(screen.getByTestId('pagination-page-size'), '50');
    expect(baseProps.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('shows ellipsis truncation for large page counts', () => {
    render(<Pagination {...baseProps} page={10} totalPages={30} />);
    // Page numbers around 10 plus first/last with ellipses.
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 9')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 10')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 11')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 30')).toBeInTheDocument();
    expect(screen.getAllByText('…').length).toBeGreaterThan(0);
  });
});
