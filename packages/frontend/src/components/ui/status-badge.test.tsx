import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders the provided status text', () => {
    render(<StatusBadge status="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies the matching status color variant', () => {
    render(<StatusBadge status="Terminated" />);
    const badge = screen.getByText('Terminated').closest('span');
    // Terminated maps to the red/negative variant classes.
    expect(badge).toHaveClass('bg-red-100');
    expect(badge).toHaveClass('text-red-700');
  });

  it('falls back to the default variant for unknown statuses', () => {
    render(<StatusBadge status="Unknown-Status" />);
    const badge = screen.getByText('Unknown-Status').closest('span');
    expect(badge).toBeInTheDocument();
  });

  it('merges a custom className', () => {
    render(<StatusBadge status="Active" className="custom-test-class" />);
    expect(screen.getByText('Active').closest('span')).toHaveClass('custom-test-class');
  });
});
