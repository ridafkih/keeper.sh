import type { NextConfig } from "next";

export default {
  output: "standalone",
  transpilePackages: [
    "@keeper.sh/auth",
    "@keeper.sh/database",
    "@keeper.sh/env",
    "@keeper.sh/log",
    "@keeper.sh/data-schemas",
    "@keeper.sh/premium",
    "@keeper.sh/broadcast-client",
  ],
  cacheComponents: true,
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "better-auth",
    "@polar-sh/better-auth",
    "@polar-sh/sdk",
  ],
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },
} satisfies NextConfig;
