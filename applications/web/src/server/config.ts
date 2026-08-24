import { type } from "entrykit";
import type { ServerConfig } from "./types";

export const envSchema = type({
  VITE_API_URL: "string.url",
  VITE_MCP_URL: "string.url?",
  ENV: "'development'|'production'|'test' = 'production'",
  PORT: "string",
});

function parsePort(variableName: string, value: string): number {
  const port = Number(value);
  const isValidPort = Number.isInteger(port) && port > 0 && port <= 65535;
  if (!isValidPort) {
    throw new Error(`${variableName} must be an integer between 1 and 65535`);
  }
  return port;
}

function deriveVitePort(serverPort: number): number {
  const derivedPort = serverPort + 1;
  if (derivedPort > 65535) {
    throw new Error("PORT must be less than 65535 to derive a Vite development port.");
  }

  return derivedPort;
}

export function createServerConfig(environment: typeof envSchema.infer): ServerConfig {
  const serverPort = parsePort("PORT", environment.PORT);
  const vitePort = deriveVitePort(serverPort);
  const runtimeEnvironment = environment.ENV;

  return {
    apiProxyOrigin: environment.VITE_API_URL,
    mcpProxyOrigin: environment.VITE_MCP_URL ?? null,
    environment: runtimeEnvironment,
    isProduction: runtimeEnvironment === "production",
    serverPort,
    vitePort,
  };
}
