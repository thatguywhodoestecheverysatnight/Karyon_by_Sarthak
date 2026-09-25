import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static: every page is prerendered, inference runs in the browser.
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
