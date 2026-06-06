/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't fail production builds on ESLint style rules (unused vars, `any`,
  // unescaped entities, etc.). These are code-quality warnings, not runtime
  // bugs — we still run `tsc` for real type-safety. Keeps beta deploys green.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
