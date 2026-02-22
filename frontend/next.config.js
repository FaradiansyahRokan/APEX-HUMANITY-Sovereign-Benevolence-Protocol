/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable SSR errors for wagmi hooks (they need browser environment)
  experimental: {
    esmExternals: "loose",
  },
};

module.exports = nextConfig;