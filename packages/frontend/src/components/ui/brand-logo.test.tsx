import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandLogo } from './brand-logo';

describe('BrandLogo', () => {
  it('renders a brand mark with the lifecycle svg', () => {
    const { container } = render(<BrandLogo />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(container.querySelector('.bg-accent-500')).toBeInTheDocument();
  });

  it('uses the dark tile when dark is set', () => {
    const { container } = render(<BrandLogo dark />);
    expect(container.querySelector('.bg-ink-900')).toBeInTheDocument();
  });

  it('accepts a custom className for sizing', () => {
    const { container } = render(<BrandLogo className="h-9 w-9" />);
    expect(container.querySelector('.h-9.w-9')).toBeInTheDocument();
  });
});
