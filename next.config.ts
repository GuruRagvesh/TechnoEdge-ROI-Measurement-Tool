import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  ...(process.env.NODE_ENV !== "production" &&
  process.env.CODESPACES === "true" &&
  process.env.APP_URL
    ? { allowedDevOrigins: [new URL(process.env.APP_URL).hostname] }
    : {}),
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next-app",
  serverExternalPackages: ["exceljs", "proper-lockfile"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
            : []),
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.sharepoint.com https://*.1drv.com https://*.onedrive.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
