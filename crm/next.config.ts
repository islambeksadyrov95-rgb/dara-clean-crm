import type { NextConfig } from "next";

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
            value: "default-src 'self' https: http: data: blob:; script-src 'self' 'unsafe-eval' 'unsafe-inline' https: http:; style-src 'self' 'unsafe-inline' https: http:; img-src 'self' data: blob: https: http:; font-src 'self' data: https: http:; connect-src 'self' https: http: wss: ws:; frame-src 'self' https: http:; frame-ancestors 'self' https: http:; object-src 'none';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
