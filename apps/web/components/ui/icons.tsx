/**
 * Inline icon set. Kept local rather than pulling an icon package — the atom
 * layer needs six glyphs, and a dependency for that is not worth the bytes.
 * All icons inherit `currentColor` and size to their box.
 */
type IconProps = React.SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const CheckIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M13 4.5 6.5 11.5 3 8" />
  </svg>
);

export const MinusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3.5 8h9" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m4 6 4 4 4-4" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="7.25" cy="7.25" r="4.25" />
    <path d="m10.5 10.5 2.5 2.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export const SpinnerIcon = ({ className = "", ...p }: IconProps) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden
    focusable={false}
    className={`animate-spin ${className}`}
    {...p}
  >
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
    <path
      d="M14 8a6 6 0 0 0-6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
