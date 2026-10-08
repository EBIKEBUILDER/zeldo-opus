import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The game owns a single WebGL engine + AudioContext; strict-mode double
  // mounting in dev would just create and immediately tear down a second one.
  reactStrictMode: false,
  // The dev-mode "N" badge sits on top of the in-game controls hint.
  devIndicators: false,
};

export default nextConfig;
