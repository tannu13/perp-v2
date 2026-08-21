import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/chrome/site-header";
import { Ramp, Swatch } from "./_components/Swatch";
import {
  Callout,
  Note,
  Panel,
  Section,
  SubHead,
  TableWrap,
  Td,
  Th,
} from "./_components/ui";
import {
  animations,
  breakpoints,
  colorGroups,
  elevations,
  layoutConstants,
  motion,
  radii,
  ramps,
  rings,
  spacingScale,
  typeScale,
} from "./_data/tokens";
import {
  buildSteps,
  designDecisions,
  openQuestions,
  stackDecisions,
  type Decision,
} from "./_data/process";

export const metadata: Metadata = {
  title: "Design system — Perp",
  description:
    "Living token reference and build log for the Perp v2 trading frontend.",
};

const NAV = [
  ["architecture", "Architecture", "01"],
  ["color", "Color", "02"],
  ["type", "Typography", "03"],
  ["space", "Spacing", "04"],
  ["shape", "Radii & borders", "05"],
  ["elevation", "Elevation", "06"],
  ["motion", "Motion", "07"],
  ["layout", "Breakpoints", "08"],
  ["process", "Build log", "09"],
  ["open", "Open questions", "10"],
] as const;

function DecisionCard({ d }: { d: Decision }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-4">
      <div className="mb-1 font-mono text-micro uppercase text-text-disabled">
        {d.title}
      </div>
      <div className="mb-3 text-body-md font-semibold text-text-primary">
        {d.choice}
      </div>
      <dl className="flex flex-col gap-2.5 text-body-sm leading-relaxed">
        <div>
          <dt className="font-mono text-micro uppercase text-buy-text">Why</dt>
          <dd className="text-text-secondary">{d.rationale}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase text-sell-text">
            Trade-off
          </dt>
          <dd className="text-text-secondary">{d.tradeoff}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <>
      {/* Global chrome. Not sticky, so the contents rail below can keep its own
          sticky offset without having to subtract a header height from it. */}
      <SiteHeader />
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-x-12 px-5 pb-24 lg:grid-cols-[208px_minmax(0,1fr)] lg:px-8">
      {/* ---------------------------------------------------- masthead --- */}
      <header className="col-span-full mb-10 border-b border-border-subtle pt-10 pb-10">
        <div className="mb-4 flex flex-wrap items-center gap-2.5 font-mono text-micro uppercase text-text-tertiary">
          <span className="size-1.5 rounded-full bg-buy shadow-[0_0_0_3px_rgb(0_194_120/0.18)]" />
          Perp v2 · Frontend
        </div>
        <h1 className="mb-3.5 text-balance text-display-md text-text-primary">
          Design system
        </h1>
        <p className="max-w-[62ch] text-body-lg leading-relaxed text-text-secondary">
          A living reference for the trading terminal — every swatch on this page
          renders through the real token and reports its own computed value, so
          these docs cannot drift from{" "}
          <code className="rounded-sm border border-border-default bg-surface-overlay px-1.5 py-0.5 font-mono text-num-sm text-text-primary">
            tokens.css
          </code>
          . The build log at the end records how it was decided.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            ["Next.js", "App Router"],
            ["Tailwind", "v4 @theme"],
            ["Charts", "Lightweight Charts"],
            ["Grid", "4px"],
            ["Families", "2"],
            ["Theme", "Dark-only"],
          ].map(([k, v]) => (
            <span
              key={k}
              className="rounded-full border border-border-default bg-surface-raised px-2.5 py-1 font-mono text-micro text-text-secondary"
            >
              <b className="font-medium text-text-primary">{k}</b> {v}
            </span>
          ))}
        </div>
      </header>

      {/* -------------------------------------------------------- rail --- */}
      <nav
        aria-label="Sections"
        className="hidden self-start lg:sticky lg:top-8 lg:block lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto"
      >
        <div className="pb-3 pl-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-disabled">
          Contents
        </div>
        {NAV.map(([id, label, num]) => (
          <a
            key={id}
            href={`#${id}`}
            className="flex items-center justify-between gap-2 border-l-2 border-transparent px-3 py-1.5 text-body-sm text-text-secondary transition-colors duration-fast hover:border-l-border-strong hover:bg-surface-hover hover:text-text-primary"
          >
            {label}
            <span className="font-mono text-[10px] text-text-disabled">
              {num}
            </span>
          </a>
        ))}
        <hr className="mx-3 my-3.5 border-0 border-t border-border-subtle" />
        <Link
          href="/design-system/components"
          className="flex px-3 py-1.5 text-body-sm text-text-link hover:underline"
        >
          Components →
        </Link>
        <Link
          href="/"
          className="flex px-3 py-1.5 text-body-sm text-text-tertiary hover:underline"
        >
          ← Home
        </Link>
      </nav>

      <main>
        {/* ------------------------------------------------ architecture -- */}
        <Section
          id="architecture"
          num="01"
          title="Token architecture"
          note="app/styles/tokens.css"
        >
          <Note>
            Two layers, strictly separated. Components never name a raw value —
            they ask for a purpose. That indirection is what makes a theme swap,
            a colorblind mode or a brand change an edit to one file instead of a
            search across every component.
          </Note>

          <Panel>
            {[
              {
                tag: "Layer 1",
                sub: "Primitives",
                body: "Raw, context-free values. Numbered ramps with no opinion about usage. Never referenced directly in JSX.",
                codes: [
                  "--color-neutral-950",
                  "--color-long-500",
                  "--color-primary-500",
                ],
                tone: "text-buy-text",
              },
              {
                tag: "Layer 2",
                sub: "Semantic aliases",
                body: "Purpose-named, pointing at Layer 1. This is the entire public API of the system.",
                codes: [
                  "--color-surface-raised",
                  "--color-buy",
                  "--color-text-tertiary",
                ],
                tone: "text-text-link",
              },
              {
                tag: "Consumption",
                sub: "Generated utilities",
                body: "Tailwind derives a utility per semantic token, so the class name states the intent.",
                codes: [
                  "bg-surface-raised",
                  "text-buy-text",
                  "border-border-subtle",
                ],
                tone: "text-text-secondary",
              },
            ].map((layer) => (
              <div
                key={layer.tag}
                className="grid grid-cols-1 gap-3.5 border-b border-border-subtle px-5 py-4 last:border-b-0 md:grid-cols-[190px_minmax(0,1fr)] md:items-start md:gap-6"
              >
                <div>
                  <div className="font-mono text-num-sm text-text-primary">
                    {layer.tag}
                  </div>
                  <div className="text-micro text-text-disabled">
                    {layer.sub}
                  </div>
                </div>
                <div className="text-body-sm leading-relaxed text-text-secondary">
                  {layer.body}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {layer.codes.map((c) => (
                      <code
                        key={c}
                        className={`rounded-sm border border-border-subtle bg-surface-inset px-1.5 py-0.5 font-mono text-num-sm ${layer.tone}`}
                      >
                        {c}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </Section>

        {/* -------------------------------------------------------- color -- */}
        <Section
          id="color"
          num="02"
          title="Color"
          note="5 ramps · 58 semantic tokens"
        >
          <SubHead>Layer 1 · primitive ramps</SubHead>
          <Note>
            Neutral steps are deliberately tight below 800 — that dark end is
            where panels separate from the canvas, and it needs more resolution
            than the light end ever will.
          </Note>

          <div className="flex flex-col gap-5">
            {ramps.map((r) => (
              <div key={r.prefix}>
                <Ramp prefix={r.prefix} steps={r.steps} />
                <div className="mt-1.5 font-mono text-micro text-text-tertiary">
                  {r.label}
                </div>
              </div>
            ))}
          </div>

          {colorGroups.map((group) => (
            <div key={group.id} className="mt-8">
              <SubHead>Layer 2 · {group.title}</SubHead>
              <Note>{group.note}</Note>
              <Panel>
                <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-inset px-3 py-2 font-mono text-micro uppercase text-text-disabled">
                  <span className="w-8 shrink-0" />
                  <span className="flex-1">Token</span>
                  <span className="shrink-0">Computed · source</span>
                </div>
                {group.tokens.map((t) => (
                  <Swatch key={t.varName} token={t} />
                ))}
              </Panel>
            </div>
          ))}

          <Callout tone="warn">
            <b className="font-semibold text-text-primary">
              Accessibility caveat carried forward.
            </b>{" "}
            Red/green as the sole carrier of direction fails for roughly 8% of
            men with deuteranopia. Every buy/sell surface must also encode
            direction non-chromatically — a +/− sign, a LONG/SHORT label, or bar
            orientation. The semantic layer makes an alternate palette a one-file
            edit; it does not excuse relying on hue alone.
          </Callout>
        </Section>

        {/* --------------------------------------------------- typography -- */}
        <Section
          id="type"
          num="03"
          title="Typography"
          note="IBM Plex superfamily"
        >
          <Note>
            Two families, hard limit — and one superfamily, which is the point.{" "}
            <b className="text-text-primary">IBM Plex Sans</b> carries the entire
            interface;{" "}
            <b className="text-text-primary">IBM Plex Mono</b> is restricted to
            order IDs, transaction hashes and API keys, where character
            disambiguation genuinely matters and a slashed zero earns its keep.
            Numbers stay in Plex Sans with tabular figures, which is why the
            order book does not shiver on every tick.
          </Note>
          <Callout>
            <b className="font-semibold text-text-primary">
              Why not a neutral grotesque.
            </b>{" "}
            The first pass used Inter, which is the reflexive choice and reads as
            one. It was swapped after a specimen bake-off against Plex, Archivo
            and Instrument Sans in a real order book. Plex won on a structural
            argument rather than taste: mono and sans sit adjacent inside the
            same table row here, and a superfamily shares a skeleton, x-height
            and weight axis, so those columns stay optically aligned. Archivo had
            the tightest set width but brings no matched mono.
          </Callout>

          <Panel className="px-5">
            {typeScale.map((t) => (
              <div
                key={t.name}
                className="grid grid-cols-1 gap-1.5 border-b border-border-subtle py-4 last:border-b-0 md:grid-cols-[168px_minmax(0,1fr)] md:items-baseline md:gap-6"
              >
                <div className="font-mono text-micro leading-relaxed text-text-tertiary tnum">
                  <b className="block text-num-sm font-medium text-text-primary">
                    {t.name}
                  </b>
                  {t.spec}
                  {t.note && (
                    <span className="block text-text-disabled">{t.note}</span>
                  )}
                </div>
                <div
                  className={[
                    t.className,
                    t.tone ?? "text-text-primary",
                    t.tabular ? "tnum" : "",
                    t.uppercase ? "uppercase" : "",
                    "break-words",
                  ].join(" ")}
                >
                  {t.sample}
                </div>
              </div>
            ))}
          </Panel>
        </Section>

        {/* ------------------------------------------------------ spacing -- */}
        <Section id="space" num="04" title="Spacing" note="4px base grid">
          <Note>
            A single multiplier generates the whole scale, so{" "}
            <code className="font-mono text-num-sm text-text-primary">p-3</code>{" "}
            is always 12px and nobody has to memorise a lookup table. A dense
            terminal lives almost entirely in steps 1–3; anything above 8 is
            page-level composition.
          </Note>

          <Panel className="p-5">
            <div className="flex flex-col gap-1">
              {spacingScale.map((s) => (
                <div
                  key={s.step}
                  className="grid grid-cols-[52px_56px_minmax(0,1fr)] items-center gap-3 font-mono text-micro tnum"
                >
                  <span className="text-text-primary">{s.step}</span>
                  <span className="text-right text-text-disabled">
                    {s.px}px
                  </span>
                  <span
                    className="h-3 rounded-xs bg-interactive opacity-55"
                    style={{ width: `${s.px}px` }}
                  />
                </div>
              ))}
            </div>
          </Panel>

          <SubHead>Fixed layout constants</SubHead>
          <Note>
            Chrome dimensions are tokenised too, so panels compute against them
            with{" "}
            <code className="font-mono text-num-sm text-text-primary">
              calc()
            </code>{" "}
            instead of scattering magic numbers across components.
          </Note>
          <TableWrap>
            <thead>
              <tr>
                <Th>Token</Th>
                <Th>Value</Th>
                <Th>Applies to</Th>
              </tr>
            </thead>
            <tbody>
              {layoutConstants.map((c) => (
                <tr key={c.token}>
                  <Td mono>{c.token}</Td>
                  <Td mono>{c.value}</Td>
                  <Td>{c.applies}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>

        {/* ------------------------------------------------ radii/borders -- */}
        <Section
          id="shape"
          num="05"
          title="Radii & borders"
          note="7 steps · 5 border tokens"
        >
          <Note>
            Radius encodes scale: the larger the surface, the softer the corner.
            Controls sit at md, containers at lg, and only modals reach xl.
          </Note>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
            {radii.map((r) => (
              <div
                key={r.name}
                className="rounded-lg border border-border-default bg-surface-overlay p-4 text-center font-mono text-micro text-text-secondary"
              >
                <div
                  className="mb-3 h-11 border border-text-disabled bg-border-strong"
                  style={{ borderRadius: r.css }}
                />
                <b className="block font-medium text-text-primary">{r.name}</b>
                <i className="not-italic text-text-disabled">
                  {r.css} · {r.usage}
                </i>
              </div>
            ))}
          </div>

          <SubHead>Border tokens</SubHead>
          <TableWrap>
            <thead>
              <tr>
                <Th>Token</Th>
                <Th>Purpose</Th>
              </tr>
            </thead>
            <tbody>
              {colorGroups
                .find((g) => g.id === "borders")!
                .tokens.map((t) => (
                  <tr key={t.varName}>
                    <Td mono>--{t.varName}</Td>
                    <Td>{t.usage}</Td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
        </Section>

        {/* ---------------------------------------------------- elevation -- */}
        <Section
          id="elevation"
          num="06"
          title="Elevation"
          note="5 tiers · 4 rings"
        >
          <Note>
            Each tier pairs a shadow with its surface token — on this ground the
            shadow alone is nearly invisible, so lightness does the real work and
            the shadow only reinforces it.
          </Note>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 rounded-lg border border-border-subtle bg-surface-base p-6">
            {elevations.map((e) => (
              <div
                key={e.name}
                className={`rounded-lg border border-border-subtle px-3.5 py-4 text-center font-mono text-micro text-text-secondary ${e.surface} ${e.shadow}`}
              >
                <b className="mb-1 block font-medium text-text-primary">
                  {e.name}
                </b>
                {e.usage}
              </div>
            ))}
          </div>

          <SubHead>Rings — state, not depth</SubHead>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 rounded-lg border border-border-subtle bg-surface-base p-6">
            {rings.map((r) => (
              <div
                key={r.name}
                className={`rounded-lg bg-surface-raised px-3.5 py-4 text-center font-mono text-micro text-text-secondary ${r.shadow}`}
              >
                <b className="mb-1 block font-medium text-text-primary">
                  {r.name}
                </b>
                {r.usage}
              </div>
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------------- motion -- */}
        <Section
          id="motion"
          num="07"
          title="Motion"
          note="4 durations · 3 curves · 8 animations"
        >
          <Note>
            Trading interfaces punish slow animation. Nothing that gates a click
            exceeds 120ms; base is for surfaces, and slow is reserved for panels
            and sheets that move a long distance.
          </Note>
          <TableWrap>
            <thead>
              <tr>
                <Th>Token</Th>
                <Th>Value</Th>
                <Th>Applies to</Th>
              </tr>
            </thead>
            <tbody>
              {motion.map((m) => (
                <tr key={m.token}>
                  <Td mono>{m.token}</Td>
                  <Td mono>{m.value}</Td>
                  <Td>{m.applies}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <SubHead>Named animations</SubHead>
          <TableWrap>
            <thead>
              <tr>
                <Th>Token</Th>
                <Th>Timing</Th>
                <Th>Applies to</Th>
              </tr>
            </thead>
            <tbody>
              {animations.map((a) => (
                <tr key={a.token}>
                  <Td mono>{a.token}</Td>
                  <Td mono>{a.value}</Td>
                  <Td>{a.applies}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <Callout tone="warn">
            <b className="font-semibold text-text-primary">
              Every animation is a token because inline ones failed silently.
            </b>{" "}
            Dialog previously carried{" "}
            <code className="font-mono text-num-sm text-text-primary">
              animate-in fade-in
            </code>
            , which belong to the tailwindcss-animate plugin. That plugin is not
            installed here, so both classes compiled to nothing and every dialog
            hard-cut into view — with a fully green build the entire time. This
            is the third defect on this project that a passing build did not
            catch, which is why the rule is to grep the compiled CSS and check
            the browser.
          </Callout>

          <Callout>
            <b className="font-semibold text-text-primary">
              Price-tick flashes are load-bearing, not decoration.
            </b>{" "}
            The book repaints many times per second;{" "}
            <code className="font-mono text-num-sm text-buy-text">
              animate-flash-buy
            </code>{" "}
            and{" "}
            <code className="font-mono text-num-sm text-sell-text">
              animate-flash-sell
            </code>{" "}
            fade a 12→0% tint over 400ms, and are the only affordance showing
            which level actually moved. Both collapse under{" "}
            <code className="font-mono text-num-sm text-text-primary">
              prefers-reduced-motion
            </code>
            .
          </Callout>
        </Section>

        {/* -------------------------------------------------- breakpoints -- */}
        <Section
          id="layout"
          num="08"
          title="Breakpoints & layout"
          note="3 targets · 2 transitional"
        >
          <Note>
            Mobile-first — unprefixed styles are the phone layout. Conventional
            Tailwind names are kept rather than custom ones, so muscle memory and
            every doc example still apply.
          </Note>

          <Panel className="p-5">
            <div className="flex flex-col gap-2.5">
              {breakpoints.map((bp) => (
                <div
                  key={bp.name}
                  className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-3.5"
                >
                  <div className="font-mono text-micro text-text-primary">
                    {bp.name}
                    <i className="block not-italic text-[10px] text-text-disabled">
                      {bp.range}
                    </i>
                  </div>
                  <div className="flex h-9 overflow-hidden rounded-md border border-border-default bg-surface-inset">
                    {bp.cols.map((c) => (
                      <div
                        key={c.label}
                        style={{ flex: c.flex }}
                        className={`flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-border-default px-1 font-mono text-[10px] text-text-secondary last:border-r-0 ${c.tone}`}
                      >
                        {c.label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="mt-5">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Target</Th>
                  <Th>Range</Th>
                  <Th>Layout behaviour</Th>
                </tr>
              </thead>
              <tbody>
                {breakpoints.map((bp) => (
                  <tr key={bp.name}>
                    <Td mono>{bp.name}</Td>
                    <Td mono>{bp.range}</Td>
                    <Td>{bp.behaviour}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </Section>

        {/* ------------------------------------------------------ process -- */}
        <Section
          id="process"
          num="09"
          title="Build log"
          note="how it was decided"
        >
          <Note>
            Kept in the repo on purpose. The decisions are the interesting part
            of a design system, and they are exactly what gets lost once the
            tokens look inevitable in hindsight.
          </Note>

          <ol className="relative flex flex-col gap-0 border-l border-border-default pl-0">
            {buildSteps.map((s) => (
              <li key={s.phase} className="relative pb-7 pl-6 last:pb-0">
                <span
                  className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-surface-base ${
                    s.status === "done" ? "bg-buy" : "bg-border-strong"
                  }`}
                />
                <div className="mb-1 flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-micro text-text-disabled">
                    {s.phase}
                  </span>
                  <h4 className="text-body-md font-semibold text-text-primary">
                    {s.title}
                  </h4>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                      s.status === "done"
                        ? "bg-buy-muted text-buy-text"
                        : "bg-surface-overlay text-text-tertiary"
                    }`}
                  >
                    {s.status === "done" ? "done" : "next"}
                  </span>
                </div>
                <p className="max-w-[68ch] text-body-sm leading-relaxed text-text-secondary">
                  {s.body}
                </p>
                {s.detail && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {s.detail.map((d) => (
                      <li
                        key={d}
                        className="flex gap-2 text-body-sm text-text-tertiary"
                      >
                        <span className="text-text-disabled">·</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          <SubHead>Stack decisions</SubHead>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {stackDecisions.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>

          <SubHead>Design decisions</SubHead>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {designDecisions.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------------- open ---- */}
        <Section
          id="open"
          num="10"
          title="Open questions"
          note="recorded, not resolved"
        >
          <Note>
            Carried deliberately rather than quietly. Each one has a decision
            point attached so it does not become an accidental default.
          </Note>
          <div className="flex flex-col gap-3">
            {openQuestions.map((q) => (
              <div
                key={q.title}
                className="rounded-lg border border-border-subtle bg-surface-raised p-4"
              >
                <h4 className="mb-1.5 text-body-md font-semibold text-warning">
                  {q.title}
                </h4>
                <p className="max-w-[72ch] text-body-sm leading-relaxed text-text-secondary">
                  {q.body}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <footer className="flex flex-wrap justify-between gap-3.5 border-t border-border-subtle pt-5 font-mono text-micro text-text-disabled">
          <span>apps/web/app/styles/tokens.css</span>
          <span>Phase 1 · dark-only · light theme = Layer 2 remap</span>
        </footer>
      </main>
      </div>
    </>
  );
}
