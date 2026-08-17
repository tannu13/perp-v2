import type { ReactNode } from "react";

export function Section({
  id,
  num,
  title,
  note,
  children,
}: {
  id: string;
  num: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-6">
      <div className="mb-6 flex flex-wrap items-baseline gap-3 border-b border-border-subtle pb-3">
        <span className="font-mono text-micro text-text-disabled">{num}</span>
        <h2 className="text-heading-md text-text-primary">{title}</h2>
        {note && (
          <span className="ml-auto font-mono text-micro text-text-tertiary">
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-8 mb-3 font-mono text-micro uppercase text-text-tertiary first:mt-0">
      {children}
    </h3>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 max-w-[68ch] text-body-sm leading-relaxed text-text-secondary">
      {children}
    </p>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border-subtle bg-surface-raised ${className}`}
    >
      {children}
    </div>
  );
}

export function Callout({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "border-l-warning bg-warning-muted"
      : "border-l-interactive bg-interactive-muted";

  return (
    <div
      className={`mt-5 max-w-[72ch] rounded-r-md border-l-2 px-4 py-3.5 text-body-sm leading-relaxed text-text-secondary ${toneClass}`}
    >
      {children}
    </div>
  );
}

/** Horizontally scrollable so a wide table never scrolls the page body. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[560px] border-collapse text-body-sm">
          {children}
        </table>
      </div>
    </Panel>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap border-b border-border-subtle bg-surface-inset px-3.5 py-2.5 text-left font-mono text-micro uppercase font-medium text-text-disabled">
      {children}
    </th>
  );
}

export function Td({
  children,
  mono = false,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`border-b border-border-subtle px-3.5 py-2.5 align-top ${
        mono
          ? "whitespace-nowrap font-mono text-num-sm text-text-primary"
          : "text-text-secondary"
      }`}
    >
      {children}
    </td>
  );
}
