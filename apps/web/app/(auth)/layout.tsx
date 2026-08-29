import Link from "next/link";
import { LogoMark } from "@/components/ui";

/**
 * The auth shell.
 *
 * No `SiteHeader`: its chrome is equity, deposit and an account menu, none of
 * which mean anything to someone who is not signed in yet. A single centred
 * card on the base canvas, with the panel treatment the terminal uses.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface-base p-4">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:shadow-focus focus-visible:outline-none"
      >
        <LogoMark className="size-6" />
        <span className="text-body-lg font-semibold tracking-tight text-text-primary">
          Perp
        </span>
      </Link>

      <main className="w-full max-w-[380px] rounded-lg border border-border-subtle bg-surface-raised p-6">
        {children}
      </main>
    </div>
  );
}
