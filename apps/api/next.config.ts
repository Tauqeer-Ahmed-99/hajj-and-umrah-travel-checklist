import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@nmt/contracts"],
  poweredByHeader: false,
};
export default config;
