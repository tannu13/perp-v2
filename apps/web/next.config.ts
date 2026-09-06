import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/shared"],
  // Emits .next/standalone — a Node server plus only the node_modules the app
  // actually reached — which is what ops/web.Dockerfile ships. `next start`
  // and `next dev` are unaffected.
  output: "standalone",
  // Without this Next traces from apps/web and guesses the workspace root,
  // warning as it goes. The monorepo root is where @repo/shared lives.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010",
  },
};

export default nextConfig;
