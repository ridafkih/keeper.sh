import arkenv from "arkenv";

const schema = {
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  COMMERCIAL_MODE: "boolean?",
  DATABASE_URL: "string.url",
  MCP_PORT: "number",
  MCP_PUBLIC_URL: "string.url",
  WEB_BASE_URL: "string.url",
} as const;

const loadMcpEnv = () => arkenv(schema);

type McpEnv = ReturnType<typeof loadMcpEnv>;

const tryLoadMcpEnv = (): McpEnv | null => {
  try {
    return loadMcpEnv();
  } catch {
    return null;
  }
};

export { schema, tryLoadMcpEnv };
export type { McpEnv };
export default loadMcpEnv();
