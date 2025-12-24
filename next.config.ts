import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Avoid monorepo root inference warning by pinning tracing root to this project
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
