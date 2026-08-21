/**
 * Inline icon set. Kept local rather than pulling an icon package — the whole
 * product needs about twenty glyphs, and a dependency for that is not worth the
 * bytes or the second drawing style.
 *
 * All icons share one 16px grid, 1.5 stroke, round caps and joins, and inherit
 * `currentColor`. That uniformity is the reason to hand-draw them: an icon set
 * mixed from two sources shows up immediately at 16px, where a 2px stroke sits
 * beside a 1.5px one in the same row.
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

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m6 4 4 4-4 4" />
  </svg>
);

export const ArrowUpRightIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5.5 10.5 10.5 5.5M6 5.5h4.5V10" />
  </svg>
);

/* --- Feedback -------------------------------------------------------------
   The three toast glyphs. Each is distinguishable in silhouette, not only by
   colour: a triangle warns, a circle-slash fails, a check confirms. Colour is
   never the only carrier — see the direction rules in CLAUDE.md. */

export const CheckCircleIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="m5.5 8 1.75 1.75L10.75 6.5" />
  </svg>
);

export const AlertTriangleIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M8 2.75 14 13H2L8 2.75Z" />
    <path d="M8 6.5v2.75" />
    <path d="M8 11.25h.01" />
  </svg>
);

export const AlertCircleIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5" />
    <path d="M8 10.75h.01" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.25v3.5" />
    <path d="M8 5.25h.01" />
  </svg>
);

export const RefreshIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.66" />
    <path d="M13.25 2.5V5.5h-3" />
  </svg>
);

/* --- Empty states ---------------------------------------------------------
   Deliberately structural rather than pictorial. An empty positions table is
   not a sad face; it is an empty container, and the glyph should say that. */

export const LayersIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M8 2 14 5l-6 3-6-3 6-3Z" />
    <path d="m2 8.5 6 3 6-3" />
  </svg>
);

export const ListIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8" />
    <path d="M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01" />
  </svg>
);

/* --- Account / chrome ----------------------------------------------------- */

export const WalletIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h7.5a1 1 0 0 1 1 1v1" />
    <path d="M2.5 5.5v6A1.5 1.5 0 0 0 4 13h8.5a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H4a1.5 1.5 0 0 1-1.5-.5Z" />
    <path d="M11 9.5h.01" />
  </svg>
);

export const UserIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="5.75" r="2.5" />
    <path d="M3.25 13.25a4.75 4.75 0 0 1 9.5 0" />
  </svg>
);

export const SettingsIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58" />
  </svg>
);

export const LogOutIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6" />
    <path d="M10.5 11 13.5 8l-3-3" />
    <path d="M13.5 8h-7" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="6" y="6" width="7.5" height="7.5" rx="1.25" />
    <path d="M3.75 10H3.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v.25" />
  </svg>
);

export const MenuIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </svg>
);

/**
 * Brand mark.
 *
 * Two opposing wedges meeting at a shared seam — the same idea the `Seam`
 * component encodes, reduced to a glyph. Filled rather than stroked so it holds
 * at 16px in a header and at 40px on the landing page.
 */
export const LogoMark = ({ className = "", ...p }: IconProps) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden
    focusable={false}
    className={className}
    {...p}
  >
    <path d="M2 3.5h5.25L4.5 8H2V3.5Z" fill="var(--color-buy)" />
    <path d="M14 12.5H8.75L11.5 8H14v4.5Z" fill="var(--color-sell)" />
    <path
      d="M2 8h12"
      stroke="var(--color-border-strong)"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
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
