import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui";
import "./globals.css";

/**
 * A true superfamily, chosen for one structural reason: in this UI mono and
 * sans sit adjacent inside the same table row — an order id beside a price.
 * Plex Sans and Plex Mono share a skeleton, x-height and weight axis, so those
 * columns align optically. An unrelated pairing does not.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Perp — Perpetual Futures Exchange",
  description:
    "Event-driven perpetual futures trading with sub-millisecond matching.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        {/* Shared tooltip timing — hovering between adjacent tooltips should
            not restart the open delay each time. */}
        <TooltipProvider delayDuration={200} skipDelayDuration={400}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
