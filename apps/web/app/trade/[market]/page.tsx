import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MARKETS, marketBySlug } from "@/lib/markets";
import { Terminal } from "@/components/terminal/terminal";

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

  return <Terminal market={market} />;
}
