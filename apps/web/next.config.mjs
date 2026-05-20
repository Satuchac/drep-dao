/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace libs ship compiled CJS + d.ts; transpile shared so Next bundles it cleanly.
  transpilePackages: ['@drep-dao/shared'],
};

export default nextConfig;
