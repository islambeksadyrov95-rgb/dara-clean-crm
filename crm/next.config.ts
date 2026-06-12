import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Browser-loaded origins only; server-side fetches (Groq, Wazzup API, Beeline)
// are not governed by CSP. 'unsafe-inline' stays for Next.js hydration scripts;
// 'unsafe-eval' and ws: are dev-only (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? " ws:" : ""}`,
  "media-src 'self' blob: https://*.supabase.co",
  "frame-src https://*.wazzup24.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Full-base import (importClients: ~4.9k clients + ~5.5k order rows in one
      // call) exceeds the 1MB default and fails with an opaque RSC error.
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
