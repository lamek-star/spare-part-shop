import type { NextConfig } from "next";

/** Baseline browser protections for every page. API responses add their own
 * (no-store, nosniff, per-file CSP) in src/server/http/core.ts. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const config: NextConfig = {
  // Served under IntraForge's launch path when built for the platform
  // (NEXT_PUBLIC_BASE_PATH=/apps/spare-parts); at the root otherwise.
  basePath,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;
