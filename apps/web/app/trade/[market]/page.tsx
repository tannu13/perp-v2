import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MARKETS, marketBySlug } from "@/lib/markets";
import { Terminal } from "@/components/terminal/terminal";
import { RequireSession } from "@/lib/auth/require-session";

/**
 * Every market is known at build time, and under `output: export` there is no
 * server left to render one that is not. A slug outside this list never reaches
 * `notFound()` below — CloudFront answers 404 first — so the check survives as
 * a build-time assertion that MARKETS and this route agree.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETS.map((m) => ({ market: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ market: string }>;
}): Promise<Metadata> {
  const { market: slug } = await params;
  const market = marketBySlug(slug);
  return {
    title: market ? `${market.slug} — Perp` : "Market not found — Perp",
  };
}

export default async function TradePage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: slug } = await params;
  const market = marketBySlug(slug);
  if (!market) notFound();

  return (
    <RequireSession>
      <Terminal market={market} />
    </RequireSession>
  );
}
