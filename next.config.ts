import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cleanDistDir: false,
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "tesseract.js", "@tesseract.js-data/eng"],
};

export default nextConfig;
