import type { NextConfig } from "next";

// Static export: `next build` writes a plain HTML/JS bundle to out/, which
// FastAPI serves at /. No Node.js server runs in production.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
