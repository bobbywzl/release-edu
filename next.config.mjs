/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't fail production builds on ESLint style rules (unused vars, `any`,
  // unescaped entities, etc.). These are code-quality warnings, not runtime
  // bugs — we still run `tsc` for real type-safety. Keeps beta deploys green.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Inline the Vercel deployment context into the client bundle so the login
  // page can (a) know it's a preview and (b) show the EXACT Google OAuth
  // redirect URI to authorize for this branch. Both are empty locally/in prod.
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? '',
    NEXT_PUBLIC_VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL ?? '',
  },
};

export default nextConfig;
