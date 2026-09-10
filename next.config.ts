import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.CATALOGUE_TEST_MODE === "1" ? ".next-e2e" : ".next",
};
export default config;
