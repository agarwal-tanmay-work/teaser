import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Prevent Next.js from trying to bundle native/server-only packages
  serverExternalPackages: ['playwright', 'fluent-ffmpeg', 'bullmq', 'ioredis'],
};

export default nextConfig;
