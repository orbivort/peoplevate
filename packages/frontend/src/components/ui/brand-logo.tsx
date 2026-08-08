import { cn } from '@/lib/utils';

type BrandLogoProps = {
  /** Toggle dark tile background (e.g. dark header / mobile). Defaults to brand teal tile. */
  dark?: boolean;
  /** Override size of the tile. Defaults to `h-8 w-8` (icon size scales automatically). */
  className?: string;
};

/**
 * Shared brand mark for Peoplevate — a bold, solid block-letter 'P' as the hero,
 * encircled by a thin lifecycle loop with milestone dots and a directional arrow,
 * echoing the continuous employee journey (hire → develop → engage → offboard).
 */
export function BrandLogo({ dark = false, className }: BrandLogoProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        dark ? 'bg-ink-900' : 'bg-accent-500',
        className ?? 'h-8 w-8',
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[68%] w-[68%] text-white"
        fill="none"
        aria-hidden="true"
      >
        {/* Lifecycle loop — thin, secondary ring around the P */}
        <path
          d="M12 4.2 A 7.8 7.8 0 1 1 4.6 10"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity="0.4"
        />
        {/* Loop arrowhead indicating forward motion */}
        <path d="M4.4 9.2 L2.9 11.4 L5.5 11.6 Z" fill="currentColor" opacity="0.4" />
        {/* Lifecycle milestone dots */}
        <circle cx="12" cy="4.4" r="0.7" fill="currentColor" opacity="0.4" />
        <circle cx="19.4" cy="12" r="0.7" fill="currentColor" opacity="0.4" />

        {/* Bold solid block-letter 'P' (single path, even-odd = real counter hole) */}
        <path
          fillRule="evenodd"
          fill="currentColor"
          d="
            M8.6 18.8 V5.4 H13 C16.8 5.4 18.2 7.8 18.2 10.9 C18.2 14 16.8 16.4 13 16.4 V18.8 Z
            M13 7.3 V14.9 C15.2 14.9 16.2 13.7 16.2 11.1 C16.2 8.5 15.2 7.3 13 7.3 Z
          "
        />
        {/* Upward growth arrow above the stem */}
        <path
          d="M8.6 5.4 L12 2.6 L15.4 5.4"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
