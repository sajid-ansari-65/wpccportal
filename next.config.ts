import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray yarn.lock in the home directory makes Turbopack guess the wrong
  // workspace root. Pin it to this project.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
