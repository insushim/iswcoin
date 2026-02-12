/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@cryptosentinel/shared"],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "https://cryptosentinel-api.simssijjang.workers.dev",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || "https://cryptosentinel-api.simssijjang.workers.dev",
  },
  trailingSlash: true,
  // 성능 최적화
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "@tanstack/react-query", "recharts", "date-fns"],
  },
  // 보안 헤더
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' https://fonts.gstatic.com",
            `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || "https://cryptosentinel-api.simssijjang.workers.dev"}`,
          ].join("; "),
        },
      ],
    },
  ],
};

module.exports = nextConfig;
