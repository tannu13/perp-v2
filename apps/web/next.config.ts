import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/shared"],
  /**
   * Emits `out/` — a directory of HTML, JS and CSS with no Node server — which
   * is uploaded to S3 and served through CloudFront.
   *
   * This is honest about what the app already is. Every route is client
   * rendered: the session cookie is host-only on the API's domain, so no
   * Server Component could read it even if one wanted to, and there are no
   * route handlers. The previous `standalone` output shipped a Node process
   * whose entire job was sending files a CDN sends better.
   *
   * What it costs, so the trade is on the record:
   *   - No route handlers, no middleware, no server rendering. Adding any of
   *     them means coming back here first.
   *   - `next start` no longer applies; `bun run start` serves `out/` instead.
   *   - An unknown market slug is a 404 from CloudFront, not from Next. See
   *     ops/web-cloudfront.md, which maps it back to this build's 404.html.
   */
  output: "export",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010",
  },
};

export default nextConfig;
