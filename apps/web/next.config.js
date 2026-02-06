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
};

module.exports = nextConfig;
