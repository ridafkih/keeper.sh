import { type } from "entrykit";
import type { ServerConfig } from "./types";

export const envSchema = type({
  API_PROXY_TARGET: "string.url",
  NODE_ENV: "'development'|'production'|'test'",
  PORT: "string",
  VITE_DEV_SERVER_PORT: "string",
});

interface ParsedEnvironment {
  API_PROXY_TARGET: string;
  NODE_ENV: "development" | "production" | "test";
  PORT: string;
  VITE_DEV_SERVER_PORT: string;
}

function parsePort(variableName: string, value: string): number {
  const port = Number(value);
  const isValidPort = Number.isInteger(port) && port > 0 && port <= 65535;
  if (!isValidPort) {
    throw new Error(`${variableName} must be an integer between 1 and 65535`);
  }
  return port;
}

export function createServerConfig(environment: ParsedEnvironment): ServerConfig {
  const serverPort = parsePort("PORT", environment.PORT);
  const vitePort = parsePort("VITE_DEV_SERVER_PORT", environment.VITE_DEV_SERVER_PORT);
  const runtimeEnvironment = environment.NODE_ENV;

  return {
    apiProxyOrigin: environment.API_PROXY_TARGET,
    environment: runtimeEnvironment,
    isProduction: runtimeEnvironment === "production",
    serverPort,
    vitePort,
  };
}
